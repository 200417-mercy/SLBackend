import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TaxRatesController } from './tax-rates.controller';
import { FeeCalculatorService } from './fee-calculator.service';
import { UpsertTaxRateDto } from './dto/upsert-tax-rate.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('TaxRatesController', () => {
  let controller: TaxRatesController;

  const mockFeeCalculator = {
    listTaxRates: jest.fn(),
    upsertTaxRate: jest.fn(),
    removeTaxRate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaxRatesController],
      providers: [{ provide: FeeCalculatorService, useValue: mockFeeCalculator }],
    }).compile();

    controller = module.get<TaxRatesController>(TaxRatesController);
    jest.clearAllMocks();
  });

  it('findAll delegates to listTaxRates', async () => {
    mockFeeCalculator.listTaxRates.mockResolvedValue([{ region: 'NG' }]);

    expect(await controller.findAll()).toEqual([{ region: 'NG' }]);
  });

  it('upsert passes region and dto', async () => {
    const dto = { ratePercent: 7.5 } as UpsertTaxRateDto;
    mockFeeCalculator.upsertTaxRate.mockResolvedValue({ region: 'NG', ratePercent: 7.5 });

    expect(await controller.upsert('NG', dto)).toEqual({ region: 'NG', ratePercent: 7.5 });
    expect(mockFeeCalculator.upsertTaxRate).toHaveBeenCalledWith('NG', dto);
  });

  it('remove passes region', async () => {
    mockFeeCalculator.removeTaxRate.mockResolvedValue({ removed: true });

    expect(await controller.remove('NG')).toEqual({ removed: true });
    expect(mockFeeCalculator.removeTaxRate).toHaveBeenCalledWith('NG');
  });

  it('is guarded and restricted to ADMIN', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TaxRatesController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, TaxRatesController)).toEqual([UserRole.ADMIN]);
  });

  it('rejects a rate above 100 percent', async () => {
    const dto = plainToInstance(UpsertTaxRateDto, { ratePercent: 150 });

    expect((await validate(dto)).map((e) => e.property)).toContain('ratePercent');
  });
});
