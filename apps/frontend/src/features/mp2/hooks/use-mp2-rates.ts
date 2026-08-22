import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getMp2Rates, updateMp2Rates } from "@/adapters";
import { QueryKeys } from "@/lib/query-keys";

export function useMp2Rates() {
  return useQuery({
    queryKey: [QueryKeys.MP2_RATES],
    queryFn: getMp2Rates,
  });
}

export function useUpdateMp2Rates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateMp2Rates,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.MP2_RATES] });
      toast.success("Dividend rates saved");
    },
    onError: (error) => toast.error(String(error)),
  });
}
