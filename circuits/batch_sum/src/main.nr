// Proves sum(private amounts) == public total without revealing individual amounts.
// Fixed batch size of 8 slots (pad unused with 0).

global BATCH_SIZE: u32 = 8;

fn main(total: pub Field, amounts: [Field; 8]) {
    let mut sum: Field = 0;
    for i in 0..BATCH_SIZE {
        sum += amounts[i];
    }
    assert(sum == total);
}

#[test]
fn test_batch_sum() {
    let amounts = [100, 200, 50, 0, 0, 0, 0, 0];
    let mut sum: Field = 0;
    for i in 0..8 {
        sum += amounts[i];
    }
    assert(sum == 350);
}
