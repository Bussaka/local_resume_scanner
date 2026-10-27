import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api, ApiError } from "@/lib/api"

/** The signed-in user (null when signed out). The session lives in an httpOnly cookie. */
export function useAuth() {
  const queryClient = useQueryClient()
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me()
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 5 * 60_000,
  })

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      queryClient.setQueryData(["me"], null)
    },
  })

  return { user: me.data ?? null, isLoading: me.isLoading, logout: () => logout.mutate() }
}
