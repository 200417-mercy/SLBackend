import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';
import { AddToWishlistDto } from './dto/add-to-wishlist.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('WishlistController', () => {
  let controller: WishlistController;

  const mockWishlistService = {
    add: jest.fn(),
    findAll: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WishlistController],
      providers: [{ provide: WishlistService, useValue: mockWishlistService }],
    }).compile();

    controller = module.get<WishlistController>(WishlistController);
    jest.clearAllMocks();
  });

  it('add passes student id and course id', async () => {
    mockWishlistService.add.mockResolvedValue({ id: 'w1' });

    expect(await controller.add('s1', { courseId: 'c1' })).toEqual({ id: 'w1' });
    expect(mockWishlistService.add).toHaveBeenCalledWith('s1', 'c1');
  });

  it('findAll passes page and limit', async () => {
    mockWishlistService.findAll.mockResolvedValue({ data: [], total: 0 });

    expect(await controller.findAll('s1', { page: 2, limit: 5 } as any)).toEqual({ data: [], total: 0 });
    expect(mockWishlistService.findAll).toHaveBeenCalledWith('s1', 2, 5);
  });

  it('remove passes student id and course id', async () => {
    mockWishlistService.remove.mockResolvedValue({ removed: true });

    expect(await controller.remove('s1', 'c1')).toEqual({ removed: true });
    expect(mockWishlistService.remove).toHaveBeenCalledWith('s1', 'c1');
  });

  it('is guarded by JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, WishlistController)).toEqual([JwtAuthGuard]);
  });

  it('rejects an add body without courseId', async () => {
    const dto = plainToInstance(AddToWishlistDto, {});

    expect((await validate(dto)).map((e) => e.property)).toContain('courseId');
  });
});
