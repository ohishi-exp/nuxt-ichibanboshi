export interface MonthlySales {
  year_month: string
  own_sales: number
  charter_sales: number
  total_sales: number
  transport_count: number
}

export interface DepartmentSales {
  department_code: string
  department_name: string
  own_sales: number
  charter_sales: number
  total_sales: number
  transport_count: number
}

export interface CustomerSales {
  customer_code: string
  customer_name: string
  own_sales: number
  charter_sales: number
  total_sales: number
  transport_count: number
}

export interface YoyComparison {
  month: string
  current_year: number
  previous_year: number
  diff: number
  diff_percent: number
}
