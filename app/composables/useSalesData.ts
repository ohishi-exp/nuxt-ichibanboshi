import type { MonthlySales, DepartmentSales, CustomerSales, YoyComparison, DailySales, CustomerMonthly, CustomerYoyResponse, CustomerDetailResponse, ApiResponse } from '~/types'

export function useSalesData() {
  const { accessToken } = useAuth()

  async function apiFetch<T>(path: string): Promise<ApiResponse<T>> {
    return await $fetch<ApiResponse<T>>(path, {
      headers: {
        ...(accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {}),
      },
    })
  }

  async function fetchMonthlySales(from: string, to: string) {
    return apiFetch<MonthlySales[]>(`/api/sales/monthly?from=${from}&to=${to}`)
  }

  async function fetchDepartmentSales(from: string, to: string) {
    return apiFetch<DepartmentSales[]>(`/api/sales/by-department?from=${from}&to=${to}`)
  }

  async function fetchCustomerSales(from: string, to: string, limit = 20) {
    return apiFetch<CustomerSales[]>(`/api/sales/by-customer?from=${from}&to=${to}&limit=${limit}`)
  }

  async function fetchYoy(year: number) {
    return apiFetch<YoyComparison[]>(`/api/sales/yoy?year=${year}`)
  }

  async function fetchCustomerTrend(from: string, to: string, limit = 20) {
    return apiFetch<CustomerMonthly[]>(`/api/sales/customer-trend?from=${from}&to=${to}&limit=${limit}`)
  }

  async function fetchCustomerDetail(code: string) {
    return apiFetch<CustomerDetailResponse>(`/api/sales/customer-detail?code=${code}`)
  }

  async function fetchCustomerYoy(from: string, to: string, limit = 50) {
    return apiFetch<CustomerYoyResponse>(`/api/sales/customer-yoy?from=${from}&to=${to}&limit=${limit}`)
  }

  async function fetchDailySales(month: string, mode = 'all') {
    return apiFetch<DailySales[]>(`/api/sales/daily?month=${month}&mode=${mode}`)
  }

  return {
    fetchMonthlySales,
    fetchDepartmentSales,
    fetchCustomerSales,
    fetchYoy,
    fetchCustomerYoy,
    fetchCustomerDetail,
    fetchDailySales,
    fetchCustomerTrend,
  }
}
