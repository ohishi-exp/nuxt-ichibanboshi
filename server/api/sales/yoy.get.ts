export default defineEventHandler(async (event) => {
  return salesApiFetch(event, '/api/sales/yoy')
})
