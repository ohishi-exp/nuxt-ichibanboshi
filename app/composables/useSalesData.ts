import type { MonthlySales, DepartmentSales, CustomerSales, YoyComparison } from '~/types'

export function useSalesData() {
  const { accessToken, refreshAccessToken, logout } = useAuth()

  async function apiFetch<T>(path: string): Promise<T> {
    const res = await $fetch<T>(path, {
      headers: {
        ...(accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {}),
      },
    })
    return res
  }

  async function fetchMonthlySales(from: string, to: string): Promise<MonthlySales[]> {
    return apiFetch(`/api/sales/monthly?from=${from}&to=${to}`)
  }

  async function fetchDepartmentSales(from: string, to: string): Promise<DepartmentSales[]> {
    return apiFetch(`/api/sales/by-department?from=${from}&to=${to}`)
  }

  async function fetchCustomerSales(from: string, to: string, limit = 20): Promise<CustomerSales[]> {
    return apiFetch(`/api/sales/by-customer?from=${from}&to=${to}&limit=${limit}`)
  }

  async function fetchYoy(year: number): Promise<YoyComparison[]> {
    return apiFetch(`/api/sales/yoy?year=${year}`)
  }

  return {
    fetchMonthlySales,
    fetchDepartmentSales,
    fetchCustomerSales,
    fetchYoy,
  }
}
