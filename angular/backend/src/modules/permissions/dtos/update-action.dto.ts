import { IsOptional, IsString } from 'class-validator';

/**
 * Data Transfer Object for updating an Action
 */
export class UpdateActionDto {
  /**
   * The name of the action (e.g., 'create', 'read', 'update', 'delete')
   * Must be unique
   */
  @IsOptional()
  @IsString()
  name?: string;

  /**
   * A description of what this action represents
   */
  @IsOptional()
  @IsString()
  description?: string;

  /**
   * The system name for consistent identification
   * Used for system-level permission checks
   */
  @IsOptional()
  @IsString()
  actionName?: string;

  /**
   * Icon to represent this action in the UI
   */
  @IsOptional()
  @IsString()
  icon?: string;
} 