import { IsBoolean, IsOptional, IsString, IsEnum } from 'class-validator';
import { NotificationType } from '../entities/notification.entity';

export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  privacyEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  securityEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  systemEnabled?: boolean;
}

export class CreateNotificationDto {
  @IsString()
  title: string;

  @IsString()
  message: string;

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsOptional()
  @IsString()
  link?: string;

  @IsOptional()
  expiresAt?: Date;
}
