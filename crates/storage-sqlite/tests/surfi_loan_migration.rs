#![allow(clippy::unwrap_used, clippy::panic, reason = "test code")]

use diesel::prelude::*;
use diesel::sql_query;
use diesel::sqlite::SqliteConnection;
use serde_json::Value;

fn apply_migration(conn: &mut SqliteConnection) {
    for statement in
        include_str!("../migrations/2026-10-17-000001_migrate_surfi_loans/up.sql").split(';')
    {
        let statement = statement.trim();
        if statement.is_empty() {
            continue;
        }
        sql_query(statement).execute(conn).unwrap();
    }
}

fn connection() -> SqliteConnection {
    let mut conn = SqliteConnection::establish(":memory:").unwrap();
    sql_query(
        "CREATE TABLE assets (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            metadata TEXT
        )",
    )
    .execute(&mut conn)
    .unwrap();
    sql_query(
        "CREATE TABLE quotes (
            id TEXT PRIMARY KEY,
            asset_id TEXT NOT NULL,
            source TEXT NOT NULL
        )",
    )
    .execute(&mut conn)
    .unwrap();
    conn
}

fn insert_asset(conn: &mut SqliteConnection, id: &str, kind: &str, metadata: &str) {
    sql_query("INSERT INTO assets (id, kind, metadata) VALUES (?, ?, ?)")
        .bind::<diesel::sql_types::Text, _>(id)
        .bind::<diesel::sql_types::Text, _>(kind)
        .bind::<diesel::sql_types::Text, _>(metadata)
        .execute(conn)
        .unwrap();
}

fn metadata(conn: &mut SqliteConnection, id: &str) -> Value {
    let raw: String = sql_query("SELECT metadata FROM assets WHERE id = ?")
        .bind::<diesel::sql_types::Text, _>(id)
        .get_result::<MetadataRow>(conn)
        .unwrap()
        .metadata;
    serde_json::from_str(&raw).unwrap()
}

#[derive(QueryableByName)]
struct MetadataRow {
    #[diesel(sql_type = diesel::sql_types::Text)]
    metadata: String,
}

#[derive(QueryableByName)]
struct CountRow {
    #[diesel(sql_type = diesel::sql_types::BigInt)]
    count: i64,
}

#[test]
fn surfi_installment_becomes_an_upstream_loan_and_drops_calculated_quotes() {
    let mut conn = connection();
    insert_asset(
        &mut conn,
        "loan-1",
        "LIABILITY",
        r#"{
            "sub_type": "mortgage",
            "interest_rate": "3.5",
            "monthly_payment": "1347.13",
            "original_term_months": "360",
            "payment_day": "15",
            "origination_date": "2020-01-01",
            "original_amount": "300000",
            "lock_in_end_date": "2025-01-01",
            "rate_schedule": [
                {"effective_from": "2020-01-01", "rate": "3.5"},
                {"effective_from": "2025-02-01", "rate": "4.25"}
            ]
        }"#,
    );
    sql_query(
        "INSERT INTO quotes (id, asset_id, source) VALUES
            ('calc', 'loan-1', 'CALCULATED'),
            ('manual', 'loan-1', 'MANUAL')",
    )
    .execute(&mut conn)
    .unwrap();

    apply_migration(&mut conn);

    let stored = metadata(&mut conn, "loan-1");
    let projection = &stored["loan_projection"];
    assert_eq!(projection["version"], 1);
    assert_eq!(projection["annualRate"], 3.5);
    assert_eq!(projection["paymentAmount"], 1347.13);
    assert_eq!(projection["frequency"], "monthly");
    assert_eq!(projection["interestMethod"], "nominal_periodic");
    assert_eq!(projection["firstPaymentDate"], "2020-02-15");
    assert_eq!(projection["paymentCount"], 360);
    assert_eq!(projection["amortizationEndDate"], "2050-01-15");
    assert_eq!(stored["renewal_maturity_date"], "2025-01-01");
    assert_eq!(stored["interest_rate"], "3.5");
    assert_eq!(stored["original_amount"], "300000");

    let events = stored["loan_events"].as_array().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["type"], "rate_change");
    assert_eq!(events[0]["effectiveDate"], "2025-02-01");
    assert_eq!(events[0]["annualRate"], 4.25);

    let quotes: i64 = sql_query("SELECT COUNT(*) AS count FROM quotes")
        .get_result::<CountRow>(&mut conn)
        .unwrap()
        .count;
    let manual: i64 = sql_query("SELECT COUNT(*) AS count FROM quotes WHERE source = 'MANUAL'")
        .get_result::<CountRow>(&mut conn)
        .unwrap()
        .count;
    assert_eq!(quotes, 1);
    assert_eq!(manual, 1);
}

#[test]
fn revolving_and_incomplete_loans_stay_manual() {
    let mut conn = connection();
    insert_asset(
        &mut conn,
        "card",
        "LIABILITY",
        r#"{"sub_type":"credit_card","interest_rate":"19.9","monthly_payment":"200","origination_date":"2020-01-01"}"#,
    );
    insert_asset(
        &mut conn,
        "no-date",
        "LIABILITY",
        r#"{"sub_type":"mortgage","interest_rate":"3.5","monthly_payment":"1000","original_term_months":"180"}"#,
    );

    apply_migration(&mut conn);

    assert!(metadata(&mut conn, "card").get("loan_projection").is_none());
    assert!(metadata(&mut conn, "no-date")
        .get("loan_projection")
        .is_none());
}
