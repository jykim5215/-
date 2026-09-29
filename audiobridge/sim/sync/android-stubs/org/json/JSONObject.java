package org.json;

import java.util.HashMap;
import java.util.Map;

public class JSONObject {
    private final Map<String, Object> map = new HashMap<>();
    public JSONObject put(String k, Object v) { map.put(k, v); return this; }
    public JSONObject put(String k, long v) { map.put(k, v); return this; }
    public long optLong(String k, long def) { Object v = map.get(k); return v instanceof Number ? ((Number) v).longValue() : def; }
    public String optString(String k, String def) { Object v = map.get(k); return v != null ? v.toString() : def; }
}
