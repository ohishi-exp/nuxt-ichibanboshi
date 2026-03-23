export interface MonthlySales {
  year_month: string
  own_sales: number
  charter_sales: number
  total_sales: number
  transport_count: number
  prev_year_own: number
  prev_year_charter: number
  prev_year_total: number
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

export interface DailySales {
  date: string
  weekday: string
  /** 税抜（月計テーブル一致） */
  own_sales: number
  charter_sales: number
  total_sales: number
  /** 金額ベース（税処理混在、参考値） */
  own_sales_raw: number
  charter_sales_raw: number
  total_sales_raw: number
  transport_count: number
  prev_year_total: number
  prev_year_total_raw: number
}

export interface CustomerMonthData {
  year_month: string
  total_sales: number
  rank: number
}

export interface CustomerMonthly {
  customer_code: string
  customer_name: string
  months: CustomerMonthData[]
}

export interface ApiResponse<T> {
  source_table: string
  data: T
}

export interface CustomerYoy {
  customer_code: string
  customer_name: string
  current_total: number
  prev_total: number
  diff: number
  yoy_percent: number
}

export interface CustomerYoyResponse {
  positive: CustomerYoy[]
  negative: CustomerYoy[]
  min_prev: number
  months: number
}

export interface CustomerDetailMonth {
  year_month: string
  own_sales: number
  charter_sales: number
  total_sales: number
  transport_count: number
}

export interface CustomerDetailResponse {
  customer_code: string
  customer_name: string
  months: CustomerDetailMonth[]
}

export interface YoyComparison {
  month: string
  current_year: number
  previous_year: number
  diff: number
  diff_percent: number
}
