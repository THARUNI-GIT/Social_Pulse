import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Block, BlockSchema, BlocksService } from './blocks.service';
import { UserBlocksClient } from './user-blocks.client';
@Module({
  imports: [MongooseModule.forFeature([{ name: Block.name, schema: BlockSchema }])],
  providers: [BlocksService, UserBlocksClient],
  exports: [BlocksService],
})
export class BlocksModule {}
