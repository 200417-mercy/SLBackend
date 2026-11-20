import { Keypair } from '@stellar/stellar-sdk';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePayoutScheduleDto } from '../../modules/payouts/dto/create-payout-schedule.dto';
import { isValidStellarAddress } from './stellar-address.validator';

describe('IsStellarAddress', () => {
  const valid = Keypair.random().publicKey();

  it('accepts a valid public key', () => {
    expect(isValidStellarAddress(valid)).toBe(true);
  });

  it.each([
    ['truncated', valid.slice(0, 55)],
    ['bad checksum', valid.slice(0, 55) + (valid.endsWith('A') ? 'B' : 'A')],
    ['secret seed', Keypair.random().secret()],
    ['wrong prefix', 'X' + valid.slice(1)],
    ['empty', ''],
    ['non-string', 123],
  ])('rejects %s', (_label, value) => {
    expect(isValidStellarAddress(value)).toBe(false);
  });

  it('rejects a malformed payout schedule address', async () => {
    const dto = plainToInstance(CreatePayoutScheduleDto, {
      frequency: 'MONTHLY',
      minimumThreshold: 10,
      stellarAddress: valid.slice(0, 40),
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['stellarAddress']);
  });
});
