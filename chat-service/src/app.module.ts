import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BlocksModule } from './blocks/blocks.module';
import { RedisModule } from './redis/redis.module';
import { PresenceModule } from './redis/presence.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { ChatGateway } from './gateway/chat.gateway';
import { EventsService } from './events/events.service';
import { SuspensionsService } from './common/suspensions.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI ?? process.env.MONGO_URI ?? 'mongodb://localhost:27017/chat_db'),
    RedisModule,
    PresenceModule,
    BlocksModule,
    ConversationsModule,
    MessagesModule,
  ],
  controllers: [HealthController],
  providers: [ChatGateway, EventsService, SuspensionsService],
})
export class AppModule {}
