-- Turn SURfi flat liability terms into upstream loan_projection so existing
-- installment loans stay editable and calculated. Revolving products, loans
-- without a payment or origination date, and loans that already have a
-- projection are left on manual valuation.
-- CALCULATED quotes were projected balances, not statements. The loan engine
-- reads every quote as a confirmed balance, so those rows are removed.

UPDATE assets
SET metadata = (
  WITH terms AS (
    SELECT
      MIN(
        28,
        MAX(
          1,
          CAST(
            COALESCE(NULLIF(json_extract(assets.metadata, '$.payment_day'), ''), '1') AS INTEGER
          )
        )
      ) AS payment_day,
      json_extract(assets.metadata, '$.origination_date') AS originated,
      CAST(COALESCE(json_extract(assets.metadata, '$.original_term_months'), '0') AS INTEGER) AS term_months,
      NULLIF(json_extract(assets.metadata, '$.lock_in_end_date'), '') AS lock_in
  ),
  dated AS (
    SELECT
      payment_day,
      term_months,
      lock_in,
      strftime(
        '%Y-%m-',
        date(originated, '+1 month')
      ) || printf('%02d', payment_day) AS first_payment
    FROM terms
  ),
  projection AS (
    SELECT
      json_object(
        'version', 1,
        'annualRate', CAST(json_extract(assets.metadata, '$.interest_rate') AS REAL),
        'paymentAmount', CAST(json_extract(assets.metadata, '$.monthly_payment') AS REAL),
        'frequency', 'monthly',
        'interestMethod', 'nominal_periodic',
        'firstPaymentDate', first_payment,
        'paymentCount', CASE WHEN term_months > 0 THEN term_months END,
        'amortizationEndDate', CASE
          WHEN term_months > 0 THEN strftime(
            '%Y-%m-',
            date(first_payment, '+' || (term_months - 1) || ' months')
          ) || substr(first_payment, 9, 2)
        END
      ) AS body,
      lock_in,
      (
        SELECT json_group_array(
          json_object(
            'type', 'rate_change',
            'effectiveDate', json_extract(change.value, '$.effective_from'),
            'annualRate', CAST(json_extract(change.value, '$.rate') AS REAL)
          )
        )
        FROM json_each(
          CASE
            WHEN json_type(assets.metadata, '$.rate_schedule') = 'text'
              THEN json(json_extract(assets.metadata, '$.rate_schedule'))
            ELSE json_extract(assets.metadata, '$.rate_schedule')
          END
        ) AS change
        WHERE json_extract(change.value, '$.effective_from') > (
          SELECT MIN(json_extract(earliest.value, '$.effective_from'))
          FROM json_each(
            CASE
              WHEN json_type(assets.metadata, '$.rate_schedule') = 'text'
                THEN json(json_extract(assets.metadata, '$.rate_schedule'))
              ELSE json_extract(assets.metadata, '$.rate_schedule')
            END
          ) AS earliest
        )
      ) AS rate_changes
    FROM dated
  )
  SELECT
    CASE
      WHEN rate_changes IS NOT NULL THEN json_set(with_lock, '$.loan_events', json(rate_changes))
      ELSE with_lock
    END
  FROM (
    SELECT
      CASE
        WHEN lock_in IS NOT NULL THEN json_set(with_projection, '$.renewal_maturity_date', lock_in)
        ELSE with_projection
      END AS with_lock,
      rate_changes
    FROM (
      SELECT
        json_set(assets.metadata, '$.loan_projection', json(body)) AS with_projection,
        lock_in,
        rate_changes
      FROM projection
    )
  )
)
WHERE kind = 'LIABILITY'
  AND json_extract(metadata, '$.loan_projection') IS NULL
  AND lower(
    COALESCE(
      json_extract(metadata, '$.sub_type'),
      json_extract(metadata, '$.liability_type'),
      ''
    )
  ) NOT IN ('credit_card', 'heloc')
  AND CAST(json_extract(metadata, '$.monthly_payment') AS REAL) > 0
  AND CAST(json_extract(metadata, '$.interest_rate') AS REAL) BETWEEN 0 AND 100
  AND length(COALESCE(json_extract(metadata, '$.origination_date'), '')) = 10;

DELETE FROM quotes
WHERE source = 'CALCULATED'
  AND asset_id IN (SELECT id FROM assets WHERE kind = 'LIABILITY');
