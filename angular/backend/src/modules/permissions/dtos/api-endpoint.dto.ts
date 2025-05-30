import { IsString, IsArray, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
}

export class ApiEndpointDto {
  @ApiProperty({ example: '/api/users', description: 'The endpoint path' })
  @IsString()
  path: string;

  @ApiProperty({
    enum: HttpMethod,
    example: HttpMethod.GET,
    description: 'HTTP method',
  })
  @IsEnum(HttpMethod)
  method: HttpMethod;

  @ApiProperty({
    example: ['users:read'],
    description: 'Required permissions for the endpoint',
  })
  @IsArray()
  @IsString({ each: true })
  requiredPermissions: string[];

  @ApiProperty({
    example: 'Get users',
    description: 'Description of the endpoint',
  })
  @IsString()
  @IsOptional()
  description?: string;
}
