import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';

/** One shared instance so the gateway and the REST presence endpoint see the same registry. */
@Module({ providers: [PresenceService], exports: [PresenceService] })
export class PresenceModule {}
