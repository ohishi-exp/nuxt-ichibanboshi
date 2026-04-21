import type { MonthlySales, DepartmentSales, CustomerSales, YoyComparison, DailySales, CustomerMonthly, CustomerYoyResponse, CustomerDetailResponse, ApiResponse, DepartmentOption, CustomerYoyByDeptResponse } from '~/types'

export function useSalesData() {
  const { token } = useAuth()

  async function apiFetch<T>(path: string): Promise<ApiResponse<T>> {
    return await $fetch<ApiResponse<T>>(path, {
      headers: {
        ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}),
      },
    })
  }

  async function fetchMonthlySales(from: string, to: string, opts?: { excludeDept?: string; includeDept?: string }) {
    const params = new URLSearchParams({ from, to })
    if (opts?.excludeDept) params.set('exclude_dept', opts.excludeDept)
    if (opts?.includeDept) params.set('include_dept', opts.includeDept)
    return apiFetch<MonthlySales[]>(`/api/sales/monthly?${params.toString()}`)
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

  async function fetchDepartments() {
    return apiFetch<DepartmentOption[]>('/api/sales/departments')
  }

  async function fetchCustomerYoyByDept(from: string, to: string, opts?: {
    department_code?: string
    limit?: number
    min_prev?: number
  }) {
    const params = new URLSearchParams({ from, to })
    if (opts?.department_code) params.set('department_code', opts.department_code)
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    if (opts?.min_prev != null) params.set('min_prev', String(opts.min_prev))
    return apiFetch<CustomerYoyByDeptResponse>(`/api/sales/customer-yoy-by-dept?${params.toString()}`)
  }

  async function fetchDailySales(month: string, mode = 'all', excludeDept?: string) {
    const params = `month=${month}&mode=${mode}${excludeDept ? `&exclude_dept=${encodeURIComponent(excludeDept)}` : ''}`
    return apiFetch<DailySales[]>(`/api/sales/daily?${params}`)
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
    fetchDepartments,
    fetchCustomerYoyByDept,
  }
}
