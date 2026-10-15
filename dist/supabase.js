// src/supabase.ts
function isMissingObject(error) {
  return error.code === "42P01" || error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205";
}
function createSupabaseQuotaStore(client, options = {}) {
  const table = options.table ?? "assistant_model_usage";
  const recordFunction = options.recordFunction ?? "record_assistant_model_request";
  const report = options.onError ?? ((error, operation) => {
    if (!isMissingObject(error)) console.error("[hoggish-assistant] quota", operation, { code: error.code, message: error.message });
  });
  return {
    async load(day) {
      const { data, error } = await client.from(table).select("model,requests,exhausted").eq("usage_date", day);
      if (error) {
        report(error, "load");
        return null;
      }
      return (data ?? []).map((row) => ({ model: row.model, requests: Number(row.requests) || 0, exhausted: Boolean(row.exhausted) }));
    },
    async record(day, model, result) {
      const { error } = await client.rpc(recordFunction, {
        p_usage_date: day,
        p_model: model,
        p_exhausted: result === "daily_limit"
      });
      if (error) report(error, "record");
    }
  };
}

export { createSupabaseQuotaStore };
//# sourceMappingURL=supabase.js.map
//# sourceMappingURL=supabase.js.map