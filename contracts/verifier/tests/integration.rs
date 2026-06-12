#![cfg(feature = "circuit-artifacts")]

use soroban_sdk::Bytes;
use ultrahonk_soroban_verifier::PROOF_BYTES;
use vellum_verifier::{UltraHonkVerifierContract, UltraHonkVerifierContractClient};

fn register<'a>(env: &'a soroban_sdk::Env, vk: &[u8]) -> UltraHonkVerifierContractClient<'a> {
    let vk_bytes = Bytes::from_slice(env, vk);
    let id = env.register(UltraHonkVerifierContract, (vk_bytes,));
    UltraHonkVerifierContractClient::new(env, &id)
}

#[test]
fn verify_withdraw_artifacts() {
    let vk: &[u8] = include_bytes!("../../../circuits/withdraw/target/vk");
    let proof: &[u8] = include_bytes!("../../../circuits/withdraw/target/proof");
    let public_inputs: &[u8] = include_bytes!("../../../circuits/withdraw/target/public_inputs");

    let env = soroban_sdk::Env::default();
    env.cost_estimate().budget().reset_unlimited();
    assert_eq!(proof.len(), PROOF_BYTES);

    let client = register(&env, vk);
    client.verify_proof(
        &Bytes::from_slice(&env, public_inputs),
        &Bytes::from_slice(&env, proof),
    );
}

#[test]
fn verify_batch_sum_artifacts() {
    let vk: &[u8] = include_bytes!("../../../circuits/batch_sum/target/vk");
    let proof: &[u8] = include_bytes!("../../../circuits/batch_sum/target/proof");
    let public_inputs: &[u8] = include_bytes!("../../../circuits/batch_sum/target/public_inputs");

    let env = soroban_sdk::Env::default();
    env.cost_estimate().budget().reset_unlimited();
    assert_eq!(proof.len(), PROOF_BYTES);

    let client = register(&env, vk);
    client.verify_proof(
        &Bytes::from_slice(&env, public_inputs),
        &Bytes::from_slice(&env, proof),
    );
}
