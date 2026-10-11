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
      // Mock FastifyReply object
      const res = {
        status: jest.fn().mockReturnThis(),
        header: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      };

      // Call the redirect method
      appController.redirect(res as any);

      // Verify methods were called correctly for redirection
      expect(res.status).toHaveBeenCalledWith(302);
      expect(res.header).toHaveBeenCalledWith('Location', '/api');
      expect(res.send).toHaveBeenCalled();
    });
  });
});
