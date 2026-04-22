import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchemaController } from './schema.controller';
import { SchemaService } from './schema.service';

@Module({
  imports: [TypeOrmModule.forFeature([])],
  controllers: [SchemaController],
  providers: [SchemaService],
  exports: [SchemaService],
})
export class SchemaModule {}
