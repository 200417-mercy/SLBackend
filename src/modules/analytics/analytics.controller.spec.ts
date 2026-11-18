import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('AnalyticsController (Role Authorization)', () => {
  let app: INestApplication;
  let controller: AnalyticsController;
  let currentUserRole: UserRole = UserRole.STUDENT;

  const mockAnalyticsService = {
    trackEvent: jest.fn(),
    trackEventsBatch: jest.fn(),
    getVolumeByEventType: jest.fn(),
    queryRawEvents: jest.fn(),
    exportAnalyticsEventsCsv: jest.fn(),
  };

  const mockJwtGuard = {
    canActivate: jest.fn((context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      req.user = { id: 'user-1', role: currentUserRole };
      return true;
    }),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: mockAnalyticsService },
        Reflector,
        RolesGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    controller = moduleRef.get<AnalyticsController>(AnalyticsController);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /analytics/events', () => {
    it('should allow any authenticated user to track an event', async () => {
      const eventDto = {
        eventType: 'course_view',
        courseName: 'React Fundamentals',
        metadata: { duration: 300 },
      };

      const mockRequest = {
        ip: '192.168.1.1',
        user: { id: 'user-1', role: UserRole.STUDENT },
      } as any;

      mockAnalyticsService.trackEvent.mockResolvedValue({
        id: 'event-1',
        eventType: 'course_view',
      });

      const result = await controller.trackEvent(
        eventDto as any,
        'user-1',
        mockRequest,
        'Mozilla/5.0',
      );

      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        eventDto,
        expect.objectContaining({
          userId: 'user-1',
          ipAddress: '192.168.1.1',
        }),
      );
      expect(result).toBeDefined();
    });

    it('should use provided userId from DTO if present', async () => {
      const eventDto = {
        eventType: 'course_view',
        userId: 'custom-user-id',
        courseName: 'React Fundamentals',
      };

      const mockRequest = { ip: '192.168.1.1' } as any;

      mockAnalyticsService.trackEvent.mockResolvedValue({ id: 'event-1' });

      await controller.trackEvent(eventDto as any, 'user-1', mockRequest);

      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          userId: 'custom-user-id',
        }),
      );
    });
  });

  describe('POST /analytics/events/batch', () => {
    it('should allow authenticated users to batch-track events', async () => {
      const batchDto = {
        events: [
          { eventType: 'page_view', pageName: 'home' },
          { eventType: 'button_click', buttonName: 'enroll' },
        ],
      };

      const mockRequest = { ip: '192.168.1.1' } as any;

      mockAnalyticsService.trackEventsBatch.mockResolvedValue({
        inserted: 2,
        failed: 0,
      });

      const result = await controller.trackEventsBatch(
        batchDto as any,
        'user-1',
        mockRequest,
      );

      expect(mockAnalyticsService.trackEventsBatch).toHaveBeenCalledWith(
        batchDto,
        expect.objectContaining({
          userId: 'user-1',
          ipAddress: '192.168.1.1',
        }),
      );
      expect(result.inserted).toBe(2);
    });
  });

  describe('GET /analytics/volume', () => {
    it('should deny non-admin access to volume endpoint', async () => {
      currentUserRole = UserRole.STUDENT;

      mockAnalyticsService.getVolumeByEventType.mockResolvedValue({
        'course_view': 1500,
        'button_click': 2300,
      });

      const req = {
        user: { id: 'user-1', role: UserRole.STUDENT },
      } as any;

      const route = Reflect.getMetadata(ROLES_KEY, controller.getVolume);
      expect(route).toContain(UserRole.ADMIN);
    });

    it('should allow admin to access volume endpoint', async () => {
      currentUserRole = UserRole.ADMIN;

      const volumeData = {
        'course_view': 1500,
        'button_click': 2300,
      };

      mockAnalyticsService.getVolumeByEventType.mockResolvedValue(volumeData);

      const result = await controller.getVolume('2024-01-01', '2024-01-31');

      expect(mockAnalyticsService.getVolumeByEventType).toHaveBeenCalledWith(
        '2024-01-01',
        '2024-01-31',
      );
      expect(result).toEqual(volumeData);
    });
  });

  describe('GET /analytics/events', () => {
    it('should deny non-admin access to query raw events', async () => {
      currentUserRole = UserRole.STUDENT;

      const route = Reflect.getMetadata(ROLES_KEY, controller.queryRawEvents);
      expect(route).toContain(UserRole.ADMIN);
    });

    it('should allow admin to query raw events', async () => {
      currentUserRole = UserRole.ADMIN;

      const queryDto = {
        eventType: 'course_view',
        limit: 100,
      };

      const rawEvents = [
        { id: 'evt-1', eventType: 'course_view' },
        { id: 'evt-2', eventType: 'course_view' },
      ];

      mockAnalyticsService.queryRawEvents.mockResolvedValue({
        data: rawEvents,
        total: 2,
      });

      const result = await controller.queryRawEvents(queryDto as any);

      expect(mockAnalyticsService.queryRawEvents).toHaveBeenCalledWith(queryDto);
      expect(result.data).toHaveLength(2);
    });
  });

  describe('GET /analytics/events/export', () => {
    it('should deny non-admin access to export endpoint', async () => {
      currentUserRole = UserRole.STUDENT;

      const route = Reflect.getMetadata(ROLES_KEY, controller.exportEvents);
      expect(route).toContain(UserRole.ADMIN);
    });

    it('should allow admin to export analytics events as CSV', async () => {
      currentUserRole = UserRole.ADMIN;

      const queryDto = { eventType: 'course_view' };

      const csvData = 'id,eventType,timestamp\nEvent1,course_view,2024-01-01';

      mockAnalyticsService.exportAnalyticsEventsCsv.mockResolvedValue({
        csv: csvData,
        rowCount: 1,
      });

      const result = await controller.exportEvents(queryDto as any);

      expect(mockAnalyticsService.exportAnalyticsEventsCsv).toHaveBeenCalledWith(
        queryDto,
      );
      expect(result.csv).toContain('id,eventType,timestamp');
      expect(result.rowCount).toBe(1);
    });
  });
});
