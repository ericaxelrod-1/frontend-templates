import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should redirect to /api', () => {
      // Mock Response object
      const res = {
        redirect: jest.fn().mockReturnThis(),
      };

      // Call the redirect method
      appController.redirect(res as any);

      // Verify redirect was called with '/api'
      expect(res.redirect).toHaveBeenCalledWith('/api');
    });
  });
});
