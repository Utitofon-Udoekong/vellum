#![cfg(feature = "circuit-artifacts")]

use std::rc::Rc;

use soroban_sdk::{
    address_payload::AddressPayload, testutils::Address as _, xdr, Bytes, BytesN, Env,
};
use vellum_pool::{VellumPool, VellumPoolClient};
use vellum_verifier::UltraHonkVerifierContract;

fn fund_test_account(env: &Env, pubkey: [u8; 32]) {
    let account_id = xdr::AccountId(xdr::PublicKey::PublicKeyTypeEd25519(xdr::Uint256(pubkey)));
    let key = Rc::new(xdr::LedgerKey::Account(xdr::LedgerKeyAccount {
        account_id: account_id.clone(),
    }));
    if env.host().get_ledger_entry(&key).unwrap().is_none() {
        let entry = Rc::new(xdr::LedgerEntry {
            data: xdr::LedgerEntryData::Account(xdr::AccountEntry {
                account_id,
                balance: 10_000_000,
                flags: 0,
                home_domain: Default::default(),
                inflation_dest: None,
                num_sub_entries: 0,
                seq_num: xdr::SequenceNumber(0),
                thresholds: xdr::Thresholds([1; 4]),
                signers: xdr::VecM::default(),
                ext: xdr::AccountEntryExt::V0,
            }),
            last_modified_ledger_seq: 0,
            ext: xdr::LedgerEntryExt::V0,
        });
        env.host().add_ledger_entry(&key, &entry, None).unwrap();
    }
}

const TEST_WITHDRAW_PUBKEY: [u8; 32] = [
    0x0f, 0x28, 0xa4, 0x1a, 0x5b, 0x3a, 0xbb, 0x29, 0x98, 0xe6, 0x3e, 0x82, 0x76, 0xdf, 0x7d,
    0xc1, 0x1d, 0xba, 0x70, 0x8f, 0x69, 0xc3, 0xf6, 0xc7, 0x05, 0x00, 0x37, 0x12, 0xba, 0xfe,
    0x20, 0xaf,
];

// leaf = Poseidon(recipient_id, amount, salt) where recipient_id = Poseidon(pubkey_lo, pubkey_hi)
const TEST_LEAF_COMMITMENT: [u8; 32] = [
    0x1d, 0xac, 0x9c, 0x85, 0xf7, 0xfd, 0x08, 0x36, 0xf6, 0x85, 0xcb, 0x99, 0xf4, 0x1a, 0x29,
    0x78, 0x98, 0x28, 0x12, 0x2d, 0xbe, 0xba, 0xc9, 0xf7, 0x45, 0xe0, 0xc2, 0x49, 0x9d, 0x37,
    0xb9, 0xb3,
];

#[test]
fn pool_finalize_and_withdraw_flow() {
    let withdraw_vk: &[u8] = include_bytes!("../../../circuits/withdraw/target/vk");
    let withdraw_proof: &[u8] = include_bytes!("../../../circuits/withdraw/target/proof");
    let withdraw_inputs: &[u8] = include_bytes!("../../../circuits/withdraw/target/public_inputs");

    let batch_vk: &[u8] = include_bytes!("../../../circuits/batch_sum/target/vk");
    let batch_proof: &[u8] = include_bytes!("../../../circuits/batch_sum/target/proof");
    let batch_inputs: &[u8] = include_bytes!("../../../circuits/batch_sum/target/public_inputs");

    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.mock_all_auths();

    let admin = soroban_sdk::Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&admin, &10_000);

    fund_test_account(&env, TEST_WITHDRAW_PUBKEY);
    let employee = AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(
        &env,
        &TEST_WITHDRAW_PUBKEY,
    ))
    .to_address(&env);
    token_admin.trust(&employee);

    let withdraw_verifier_id = env.register(
        UltraHonkVerifierContract,
        (Bytes::from_slice(&env, withdraw_vk),),
    );
    let batch_verifier_id = env.register(
        UltraHonkVerifierContract,
        (Bytes::from_slice(&env, batch_vk),),
    );

    let pool_id = env.register(
        VellumPool,
        (
            admin.clone(),
            token.clone(),
            withdraw_verifier_id,
            batch_verifier_id,
        ),
    );
    let pool = VellumPoolClient::new(&env, &pool_id);

    let commitment = BytesN::from_array(&env, &TEST_LEAF_COMMITMENT);
    pool.deposit(&commitment);

    pool.finalize_batch(
        &350,
        &Bytes::from_slice(&env, batch_inputs),
        &Bytes::from_slice(&env, batch_proof),
    );

    pool.withdraw(
        &employee,
        &Bytes::from_slice(&env, withdraw_inputs),
        &Bytes::from_slice(&env, withdraw_proof),
    );
}

#[test]
fn withdraw_wrong_employee_rejected() {
    let withdraw_vk: &[u8] = include_bytes!("../../../circuits/withdraw/target/vk");
    let withdraw_proof: &[u8] = include_bytes!("../../../circuits/withdraw/target/proof");
    let withdraw_inputs: &[u8] = include_bytes!("../../../circuits/withdraw/target/public_inputs");

    let batch_vk: &[u8] = include_bytes!("../../../circuits/batch_sum/target/vk");
    let batch_proof: &[u8] = include_bytes!("../../../circuits/batch_sum/target/proof");
    let batch_inputs: &[u8] = include_bytes!("../../../circuits/batch_sum/target/public_inputs");

    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.mock_all_auths();

    let admin = soroban_sdk::Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&admin, &10_000);

    fund_test_account(&env, TEST_WITHDRAW_PUBKEY);
    let employee = AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(
        &env,
        &TEST_WITHDRAW_PUBKEY,
    ))
    .to_address(&env);
    token_admin.trust(&employee);

    let withdraw_verifier_id = env.register(
        UltraHonkVerifierContract,
        (Bytes::from_slice(&env, withdraw_vk),),
    );
    let batch_verifier_id = env.register(
        UltraHonkVerifierContract,
        (Bytes::from_slice(&env, batch_vk),),
    );

    let pool_id = env.register(
        VellumPool,
        (
            admin.clone(),
            token.clone(),
            withdraw_verifier_id,
            batch_verifier_id,
        ),
    );
    let pool = VellumPoolClient::new(&env, &pool_id);

    let commitment = BytesN::from_array(&env, &TEST_LEAF_COMMITMENT);
    pool.deposit(&commitment);

    pool.finalize_batch(
        &350,
        &Bytes::from_slice(&env, batch_inputs),
        &Bytes::from_slice(&env, batch_proof),
    );

    let attacker = soroban_sdk::Address::generate(&env);
    let err = pool
        .try_withdraw(
            &attacker,
            &Bytes::from_slice(&env, withdraw_inputs),
            &Bytes::from_slice(&env, withdraw_proof),
        )
        .expect_err("wrong employee should be rejected");
    assert_eq!(
        err,
        Ok(vellum_pool::contract::PoolError::InvalidRecipient)
    );
}
