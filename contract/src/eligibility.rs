//! check_eligibility: reads a beneficiary's stored eligibility decision from the
//! private `z:<tid>:eligibility` KV map. No PII is read or returned — only an opaque
//! beneficiary id in, and an approve/deny decision out.

use alloc::string::{String, ToString};
use alloc::vec::Vec;

#[derive(serde::Deserialize)]
pub struct CheckReq {
    pub beneficiary_id: String,
}

/// Decision as stored in the `eligibility` map value (set by the verification tenant).
#[derive(serde::Deserialize, serde::Serialize, Default)]
pub struct Decision {
    pub approved: bool,
    #[serde(default)]
    pub zone: String,
    #[serde(default)]
    pub reason: String,
}

/// Full response echoed back to the caller (decision + the id it applies to).
#[derive(serde::Serialize)]
pub struct CheckResp {
    pub beneficiary_id: String,
    pub approved: bool,
    pub zone: String,
    pub reason: String,
}

/// Entry point from `lib.rs`. `input` is the raw JSON bytes from `generic-input.input`.
pub fn check_eligibility(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: CheckReq =
        serde_json::from_slice(input).map_err(|e| alloc::format!("check-eligibility: bad input: {e}"))?;

    #[cfg(target_arch = "wasm32")]
    {
        let resp = check_eligibility_wasm(&req.beneficiary_id)?;
        serde_json::to_vec(&resp).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = req;
        Err("check_eligibility is only implemented on the wasm32 target".to_string())
    }
}

/// Look up `beneficiary_id` in `z:<tid>:eligibility`. Absent key => denied (default-deny).
#[cfg(target_arch = "wasm32")]
pub fn check_eligibility_wasm(beneficiary_id: &str) -> Result<CheckResp, String> {
    use crate::host::interfaces::logging;

    let decision = read_decision(beneficiary_id)?;
    let _ = logging::info(&alloc::format!(
        "eligibility check: id={beneficiary_id} approved={}",
        decision.approved
    ));

    Ok(CheckResp {
        beneficiary_id: beneficiary_id.to_string(),
        approved: decision.approved,
        zone: decision.zone,
        reason: if decision.reason.is_empty() {
            if decision.approved {
                "eligible".to_string()
            } else {
                "no approved eligibility record".to_string()
            }
        } else {
            decision.reason
        },
    })
}

/// Read + parse a beneficiary's decision from the eligibility map. Missing key yields a
/// default (denied) decision rather than an error, so a non-enrolled id reads as "denied".
#[cfg(target_arch = "wasm32")]
pub fn read_decision(beneficiary_id: &str) -> Result<Decision, String> {
    use crate::host::interfaces::kv_store;
    use crate::host::tenant::tenant_context;

    let tid = tenant_context::tenant_did();
    let map_name = alloc::format!("z:{}:eligibility", hex::encode(&tid));
    match kv_store::get(&map_name, beneficiary_id.as_bytes()).map_err(|e| alloc::format!("kv read: {e}"))? {
        Some(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| alloc::format!("eligibility decode for {beneficiary_id}: {e}")),
        None => Ok(Decision::default()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bad_input_is_rejected() {
        let err = check_eligibility(b"not json").unwrap_err();
        assert!(err.contains("bad input"), "got: {err}");
    }

    #[test]
    fn non_wasm_is_unimplemented() {
        let input = serde_json::to_vec(&serde_json::json!({ "beneficiary_id": "ben_001" })).unwrap();
        let err = check_eligibility(&input).unwrap_err();
        assert!(err.contains("only implemented on the wasm32 target"), "got: {err}");
    }

    #[test]
    fn decision_roundtrips() {
        let d = Decision { approved: true, zone: "Z3".into(), reason: "flood zone".into() };
        let bytes = serde_json::to_vec(&d).unwrap();
        let back: Decision = serde_json::from_slice(&bytes).unwrap();
        assert!(back.approved);
        assert_eq!(back.zone, "Z3");
    }
}
