import { Module } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { EventsService } from './events/events.service';
import { EmailService } from './email/email.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { GoogleController } from './auth/google.controller';
import { GoogleService } from './auth/google.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { AdminController } from './users/admin.controller';
import { HealthController } from './health.controller';
@Module({ controllers: [AuthController, GoogleController, UsersController, AdminController, HealthController], providers: [PrismaService, EventsService, EmailService, AuthService, GoogleService, UsersService] })
export class AppModule {}
