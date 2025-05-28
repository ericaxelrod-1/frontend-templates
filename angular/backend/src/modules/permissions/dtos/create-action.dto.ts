import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Data Transfer Object for creating a new Action
 */
export class CreateActionDto {
  /**
   * The name of the action (e.g., 'create', 'read', 'update', 'delete')
   * Must be unique
   */
  @IsNotEmpty()
  @IsString()
  name: string;

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
  @IsNotEmpty()
  @IsString()
  actionName: string;

  /**
   * Icon to represent this action in the UI
   */
  @IsOptional()
  @IsString()
  icon?: string;
} 