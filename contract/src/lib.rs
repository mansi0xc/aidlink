//! AidLink v0.1.0 — disaster-relief eligibility + privacy-preserving payout.
//!
//! Two exports:
//!   - `check-eligibility`: reads a beneficiary's eligibility flag from the private
//!     `z:<tid>:eligibility` KV map and returns approved/denied. No PII crosses the
//!     WIT boundary in either direction.
//!   - `disburse-payout`: re-verifies eligibility, then POSTs a payout instruction to
//!     the (operator-controlled) payout endpoint via the host's
//!     `http-with-placeholders` interface. The payee name and bank account number are
//!     `{{profile.<field>}}` markers the host resolves from the calling beneficiary's
//!     profile at dispatch time — the contract WASM never holds the plaintext account.
//!
//! In Phase 1 both exports live in one contract. In Phase 2 `check-eligibility` is
//! owned by the verification tenant (A) and `disburse-payout` by the disbursement
//! tenant (B), which calls A cross-tenant via the SDK's `executeBusinessContract`.
//!
//! # Host-capability requirements (manifest)
//! ```json
//! { "host_capabilities": ["kv_store","logging","tenant_context","http_with_placeholders"] }
//! ```
//!
//! # Setup (via the tenant SDK, before first use)
//!   - create `z:<tid>:eligibility`, write per-beneficiary decisions
//!   - create `z:<tid>:secrets`, write `payout_api_key`
//!   - allow-list the payout endpoint host on the contract's `http_allow_list`
//!   - grant the beneficiary's profile to the contract (gates `{{profile.*}}` resolution)
#![warn(clippy::style, missing_debug_implementations)]
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

pub const CONTRACT_VERSION: &str = "0.1.0";

wit_bindgen::generate!({
    world: "aidlink",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod eligibility;
mod payout;
mod probe;

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::aidlink::contracts::Guest for Component {
    fn check_eligibility(
        req: exports::z::aidlink::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("check-eligibility: missing input")?;
        eligibility::check_eligibility(&input)
    }

    fn disburse_payout(
        req: exports::z::aidlink::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("disburse-payout: missing input")?;
        payout::disburse_payout(&input)
    }

    fn probe_placeholder(
        req: exports::z::aidlink::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("probe-placeholder: missing input")?;
        probe::probe_placeholder(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::CONTRACT_VERSION;

    #[test]
    fn contract_version_is_semver() {
        let parts: alloc::vec::Vec<&str> = CONTRACT_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "CONTRACT_VERSION must be MAJOR.MINOR.PATCH");
        for part in parts {
            assert!(part.parse::<u32>().is_ok(), "each part must be a number");
        }
    }
}
