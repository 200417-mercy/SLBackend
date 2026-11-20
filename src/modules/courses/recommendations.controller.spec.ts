import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

describe('RecommendationsController', () => {
  let controller: RecommendationsController;
  const mockService = { getRecommendations: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationsController],
      providers: [{ provide: RecommendationsService, useValue: mockService }],
    }).compile();

    controller = module.get(RecommendationsController);
    jest.clearAllMocks();
  });

  it('returns the service result for a course with an explicit limit', async () => {
    const recs = [{ id: 'course-2', title: 'Welding 101' }];
    mockService.getRecommendations.mockResolvedValue(recs);

    await expect(controller.getRecommendations('course-1', '3' as any)).resolves.toEqual(recs);
    expect(mockService.getRecommendations).toHaveBeenCalledWith('course-1', 3);
  });

  it('defaults the limit to 5 when none or 0 is given', async () => {
    mockService.getRecommendations.mockResolvedValue([]);

    await controller.getRecommendations('course-1');
    await controller.getRecommendations('course-1', 0);

    expect(mockService.getRecommendations).toHaveBeenNthCalledWith(1, 'course-1', 5);
    expect(mockService.getRecommendations).toHaveBeenNthCalledWith(2, 'course-1', 5);
  });

  it('propagates NotFoundException for an unknown course', async () => {
    mockService.getRecommendations.mockRejectedValue(new NotFoundException('Course not found'));

    await expect(controller.getRecommendations('missing')).rejects.toThrow(NotFoundException);
  });
});
