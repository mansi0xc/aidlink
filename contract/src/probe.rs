//! probe_placeholder: the cheapest possible isolated check of host placeholder resolution.
//!
//! Phase 1's FIRST live invocation. It deliberately does the minimum metered work:
//!   - reads NO KV maps and NO secrets (the URL comes in via `input`)
//!   - performs exactly ONE host call: `http-with-placeholders::call`
//!   - templates exactly ONE `{{profile.<field>}}` marker (default `first_name`)
//!
//! Purpose: confirm that (a) the substitution mechanism works at all, and (b) our
//! beneficiary grant + profile wiring is correct — BEFORE spending tokens probing the
//! riskier custom `{{profile.bank_account}}` field (see BUGS.md BUG-006) or running the
//! full eligibility+payout flow.

use alloc::string::{String, ToString};
use alloc::vec::Vec;

#[derive(serde::Deserialize)]
pub struct ProbeReq {
    /// Echo endpoint to POST to. Its host must be on the contract's http_allow_list.
    pub url: String,
    /// Profile field to template. Defaults to a known-good field (`first_name`).
    #[serde(default = "default_field")]
    pub field: String,
}

fn default_field() -> String {
    "first_name".to_string()
}

pub fn probe_placeholder(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: ProbeReq =
        serde_json::from_slice(input).map_err(|e| alloc::format!("probe-placeholder: bad input: {e}"))?;

    if req.field.contains("..") || req.field.contains('{') {
        return Err("probe-placeholder: invalid field".to_string());
    }

    #[cfg(target_arch = "wasm32")]
    {
        probe_wasm(&req.url, &req.field)
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = req;
        Err("probe_placeholder is only implemented on the wasm32 target".to_string())
    }
}

#[cfg(target_arch = "wasm32")]
fn probe_wasm(url: &str, field: &str) -> Result<Vec<u8>, String> {
    use crate::host::interfaces::{http_with_placeholders as hwp, logging};
    use serde_json::json;

    // The ONLY thing this body carries is the unresolved template — the contract never
    // holds the resolved value on the way out.
    let marker = alloc::format!("{{{{profile.{field}}}}}");
    let body = json!({ "probe_field": field, "probe_value": marker });

    let _ = logging::info(&alloc::format!(
        "placeholder probe: field={field} -> POST {url} (value sent as template marker)"
    ));

    let resp = hwp::call(&hwp::Request {
        method: hwp::Verb::Post,
        url: url.to_string(),
        headers: Some(alloc::vec![("Accept".to_string(), "application/json".to_string())]),
        payload: Some(serde_json::to_vec(&body).map_err(|e| e.to_string())?),
    })
    .map_err(|e| alloc::format!("probe call: {}", crate::payout::format_http_error(e)))?;

    if resp.code != 200 && resp.code != 201 {
        return Err(alloc::format!("probe endpoint failed: HTTP {}", resp.code));
    }
    Ok(resp.payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_first_name() {
        let req: ProbeReq = serde_json::from_slice(br#"{"url":"https://x/echo"}"#).unwrap();
        assert_eq!(req.field, "first_name");
    }

    #[test]
    fn rejects_injection_field() {
        let input = br#"{"url":"https://x/echo","field":"a{b"}"#;
        let err = probe_placeholder(input).unwrap_err();
        assert!(err.contains("invalid field"), "got: {err}");
    }

    #[test]
    fn non_wasm_is_unimplemented() {
        let input = br#"{"url":"https://x/echo","field":"first_name"}"#;
        let err = probe_placeholder(input).unwrap_err();
        assert!(err.contains("only implemented on the wasm32 target"), "got: {err}");
    }
}
