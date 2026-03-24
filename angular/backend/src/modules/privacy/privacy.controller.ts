import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrivacyService } from './privacy.service';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: { id: number; email: string };
}

const VALID_PROCESSING_TYPES = [
  'analytics',
  'marketing',
  'third_party',
  'profiling',
];

interface PrivacyRestrictionsBody {
  restrictions: Record<string, boolean>;
}

interface ProcessingObjectionBody {
  processingType: string;
  reason: string;
}

interface MarketingConsentBody {
  consent: boolean;
}

interface DoNotSellBody {
  doNotSell: boolean;
}

@Controller('privacy')
@UseGuards(AuthGuard('jwt'))
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Get('preferences')
  async getPreferences(@Req() req: AuthenticatedRequest) {
    return this.privacyService.getPrivacyPreferences(req.user.id);
  }

  @Get('export')
  async exportData(@Req() req: AuthenticatedRequest) {
    const data = await this.privacyService.exportUserData(req.user.id);
    return {
      exportedAt: new Date().toISOString(),
      format: 'json',
      data,
    };
  }

  @Post('export/download')
  async downloadData(@Req() req: AuthenticatedRequest) {
    const data = await this.privacyService.exportUserData(req.user.id);
    return data;
  }

  @Delete('account')
  @HttpCode(HttpStatus.OK)
  async deleteAccount(@Req() req: AuthenticatedRequest) {
    return this.privacyService.deleteAccount(req.user.id);
  }

  @Patch('restrictions')
  async updateRestrictions(
    @Req() req: AuthenticatedRequest,
    @Body() body: PrivacyRestrictionsBody,
  ) {
    if (!body.restrictions || typeof body.restrictions !== 'object') {
      throw new BadRequestException('Restrictions must be an object');
    }
    return this.privacyService.updatePrivacyRestrictions(req.user.id, {
      restrictions: body.restrictions,
    });
  }

  @Post('object')
  async submitObjection(
    @Req() req: AuthenticatedRequest,
    @Body() body: ProcessingObjectionBody,
  ) {
    if (
      !body.processingType ||
      !VALID_PROCESSING_TYPES.includes(body.processingType)
    ) {
      throw new BadRequestException(
        `Invalid processingType. Must be one of: ${VALID_PROCESSING_TYPES.join(', ')}`,
      );
    }
    if (!body.reason || body.reason.trim().length === 0) {
      throw new BadRequestException('Reason is required');
    }
    return this.privacyService.submitProcessingObjection(req.user.id, {
      processingType: body.processingType,
      reason: body.reason,
    });
  }

  @Delete('object/:processingType')
  async removeObjection(
    @Req() req: AuthenticatedRequest,
    @Param('processingType') processingType: string,
  ) {
    if (!VALID_PROCESSING_TYPES.includes(processingType)) {
      throw new BadRequestException(
        `Invalid processingType. Must be one of: ${VALID_PROCESSING_TYPES.join(', ')}`,
      );
    }
    return this.privacyService.removeProcessingObjection(
      req.user.id,
      processingType,
    );
  }

  @Patch('marketing')
  async updateMarketingConsent(
    @Req() req: AuthenticatedRequest,
    @Body() body: MarketingConsentBody,
  ) {
    return this.privacyService.updateMarketingConsent(
      req.user.id,
      body.consent,
    );
  }

  @Patch('do-not-sell')
  async updateDoNotSell(
    @Req() req: AuthenticatedRequest,
    @Body() body: DoNotSellBody,
  ) {
    return this.privacyService.updateDoNotSell(req.user.id, body.doNotSell);
  }
}
