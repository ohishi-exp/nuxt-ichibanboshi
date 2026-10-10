export default defineEventHandler(async (event) => {
  return ichibanWorkerFetch(event, '/api/sales/customer-yoy-by-dept')
})
