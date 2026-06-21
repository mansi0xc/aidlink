//! disburse_payout: the privacy-preserving payout path.
//!
//! The beneficiary's payee name and bank account number are NEVER passed in as contract
//! arguments and never read from KV. The contract templates `{{profile.<field>}}` markers
//! into the payout request body; the host's `http-with-placeholders` interface resolves
//! them from the calling beneficiary's profile at dispatch time — *after* this contract
//! serialises the body and *before* the outbound HTTP call. A compromised contract that
//! reads the bytes back sees only the unresolved template, never the account number.
//!
//! Flow:
//!   1. parse { beneficiary_id, amount, currency }
//!   2. re-verify eligibility against `z:<tid>:eligibility` (default-deny)
//!   3. read the payout endpoint API key from `z:<tid>:secrets`
//!   4. POST the templated instruction via http-with-placeholders
//!   5. return { payout_id, account_masked, status } from the endpoint's response
//!
//! The endpoint (operator-controlled mock in Phase 1) receives the host-resolved account,
//! masks it (last 4), and echoes the mask back — so the masking happens outside the
//! contract and the audit trail only ever shows a masked number.

use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// Marker the contract sends in place of the real account number. Resolved host-side from
/// the beneficiary's profile. Stored as a custom profile field at enrolment time.
const ACCOUNT_PLACEHOLDER: &str = "{{profile.bank_account}}";
const FIRST_NAME_PLACEHOLDER: &str = "{{profile.first_name}}";
const LAST_NAME_PLACEHOLDER: &str = "{{profile.last_name}}";

/// Payout endpoint. The host gates egress on the contract's `http_allow_list`, so this
/// host must be allow-listed at admit/grant time or the call returns `egress-denied`.
/// Overridable at runtime via the `payout_url` key in `z:<tid>:secrets`.
const DEFAULT_PAYOUT_URL: &str = "https://aidlink-payout.example.com/v1/payouts";

#[derive(serde::Deserialize)]
pub struct PayoutReq {
    pub beneficiary_id: String,
    pub amount: String,
    pub currency: String,
}

/// What the payout endpoint returns (and what we echo to the caller). `account_masked`
/// is produced by the endpoint from the host-resolved account — the contract never sees
/// the full number, so it cannot (and does not) compute the mask itself.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct PayoutResp {
    pub payout_id: String,
    pub account_masked: String,
    pub status: String,
    #[serde(default)]
    pub beneficiary_id: String,
}

/// Entry point from `lib.rs`. `input` is raw JSON bytes from `generic-input.input`.
pub fn disburse_payout(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: PayoutReq =
        serde_json::from_slice(input).map_err(|e| alloc::format!("disburse-payout: bad input: {e}"))?;

    // Guard against an integrator accidentally trying to pass the account inline: any
    // `bank_account` / `account_number` field in the input is a protocol violation —
    // PII must flow only through the host placeholder path, never as an argument.
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(input) {
        if v.get("bank_account").is_some() || v.get("account_number").is_some() {
            return Err("disburse-payout: bank account must NOT be passed inline; it is \
                        resolved host-side via {{profile.bank_account}}"
                .to_string());
        }
    }

    #[cfg(target_arch = "wasm32")]
    {
        let resp = disburse_payout_wasm(req)?;
        serde_json::to_vec(&resp).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = req;
        Err("disburse_payout is only implemented on the wasm32 target".to_string())
    }
}

#[cfg(target_arch = "wasm32")]
fn disburse_payout_wasm(req: PayoutReq) -> Result<PayoutResp, String> {
    use crate::host::interfaces::{http_with_placeholders as hwp, logging};
    use serde_json::json;

    // (2) Re-verify eligibility before paying anyone — default-deny.
    let decision = crate::eligibility::read_decision(&req.beneficiary_id)?;
    if !decision.approved {
        let _ = logging::error(&alloc::format!(
            "payout refused: {} is not approved",
            req.beneficiary_id
        ));
        return Err(alloc::format!(
            "payout refused: beneficiary {} is not eligible",
            req.beneficiary_id
        ));
    }

    // (3) Endpoint credentials + URL from the secrets map (never hardcoded keys).
    let api_key = read_secret("payout_api_key")?
        .ok_or("payout_api_key not found in z:<tid>:secrets — seed it via the tenant SDK")?;
    let url = read_secret("payout_url")?.unwrap_or_else(|| DEFAULT_PAYOUT_URL.to_string());

    // (4) Build the instruction with PLACEHOLDERS only. The contract never holds the
    // plaintext account number or payee name — these strings are templates until the
    // host substitutes them on the outbound stack.
    let body = json!({
        "beneficiary_id": req.beneficiary_id,
        "amount": req.amount,
        "currency": req.currency,
        "payee": {
            "first_name": FIRST_NAME_PLACEHOLDER,
            "last_name": LAST_NAME_PLACEHOLDER,
            "bank_account": ACCOUNT_PLACEHOLDER,
        }
    });

    let _ = logging::info(&alloc::format!(
        "submitting payout for {} ({} {}) — account sent as placeholder, not plaintext",
        req.beneficiary_id, req.amount, req.currency
    ));

    let resp = hwp::call(&hwp::Request {
        method: hwp::Verb::Post,
        url,
        headers: Some(alloc::vec![
            ("Authorization".to_string(), alloc::format!("Bearer {api_key}")),
            ("Accept".to_string(), "application/json".to_string()),
        ]),
        payload: Some(serde_json::to_vec(&body).map_err(|e| e.to_string())?),
    })
    .map_err(|e| alloc::format!("payout call: {}", format_http_error(e)))?;

    if resp.code != 200 && resp.code != 201 {
        let _ = logging::error(&alloc::format!("payout endpoint HTTP {}", resp.code));
        return Err(alloc::format!("payout endpoint failed: HTTP {}", resp.code));
    }

    let mut out: PayoutResp =
        serde_json::from_slice(&resp.payload).map_err(|e| alloc::format!("payout resp decode: {e}"))?;
    out.beneficiary_id = req.beneficiary_id;

    let _ = logging::info(&alloc::format!(
        "payout ok: id={} account={} status={}",
        out.payout_id, out.account_masked, out.status
    ));
    Ok(out)
}

/// Read a key from the tenant `secrets` map.
#[cfg(target_arch = "wasm32")]
fn read_secret(key: &str) -> Result<Option<String>, String> {
    use crate::host::interfaces::kv_store;
    use crate::host::tenant::tenant_context;

    let tid = tenant_context::tenant_did();
    let map_name = alloc::format!("z:{}:secrets", hex::encode(&tid));
    match kv_store::get(&map_name, key.as_bytes()).map_err(|e| alloc::format!("kv read: {e}"))? {
        Some(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|e| alloc::format!("secret {key} utf8: {e}")),
        None => Ok(None),
    }
}

/// Render a typed `http-with-placeholders` error. Never includes resolved PII — only
/// field names and host-side reasons.
#[cfg(target_arch = "wasm32")]
pub(crate) fn format_http_error(e: crate::host::interfaces::http_with_placeholders::HttpError) -> String {
    use crate::host::interfaces::http_with_placeholders::HttpError;
    match e {
        HttpError::EgressDenied(host) => alloc::format!("egress denied for host {host}"),
        HttpError::PlaceholderDenied(marker) => alloc::format!("placeholder not permitted: {marker}"),
        HttpError::PlaceholderUnknown(field) => alloc::format!("beneficiary profile missing field: {field}"),
        HttpError::PlaceholderNoUserContext => "no beneficiary context bound for placeholder resolution".to_string(),
        HttpError::UpstreamError(reason) => alloc::format!("upstream: {reason}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bad_input_is_rejected() {
        let err = disburse_payout(b"not json").unwrap_err();
        assert!(err.contains("bad input"), "got: {err}");
    }

    #[test]
    fn inline_bank_account_is_rejected() {
        let input = serde_json::to_vec(&serde_json::json!({
            "beneficiary_id": "ben_001",
            "amount": "250.00",
            "currency": "USD",
            "bank_account": "12345678",
        }))
        .unwrap();
        let err = disburse_payout(&input).unwrap_err();
        assert!(err.contains("must NOT be passed inline"), "got: {err}");
    }

    #[test]
    fn non_wasm_is_unimplemented() {
        let input = serde_json::to_vec(&serde_json::json!({
            "beneficiary_id": "ben_001",
            "amount": "250.00",
            "currency": "USD",
        }))
        .unwrap();
        let err = disburse_payout(&input).unwrap_err();
        assert!(err.contains("only implemented on the wasm32 target"), "got: {err}");
    }

    #[test]
    fn placeholders_are_templates_not_real_values() {
        // The contract must only ever emit the marker, never a real account number.
        assert_eq!(ACCOUNT_PLACEHOLDER, "{{profile.bank_account}}");
        assert!(ACCOUNT_PLACEHOLDER.starts_with("{{profile."));
        assert!(FIRST_NAME_PLACEHOLDER.starts_with("{{profile."));
        assert!(LAST_NAME_PLACEHOLDER.starts_with("{{profile."));
    }
}
