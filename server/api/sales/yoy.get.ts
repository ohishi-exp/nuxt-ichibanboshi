export default defineEventHandler(async (event) => {
  return ichibanWorkerFetch(event, '/api/sales/yoy')
})
