import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConvDto {
  @IsString()
  conversationId: string;
}

export class SendDto {
  @IsString()
  conversationId: string;

  @IsString()
  // Without a cap a single socket frame could store an arbitrarily large message.
  @MaxLength(4000)
  content: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  mediaUrls?: string[];

  @IsOptional()
  @IsString()
  clientTempId?: string;
}

export class SharePostDto {
  @IsString()
  postId: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  conversationIds?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  userIds?: string[];

  @IsOptional() @IsString() @MaxLength(1000)
  content?: string;
}

export class ReadDto {
  @IsString()
  conversationId: string;

  @IsString()
  messageId: string;
}

/** Sent by a recipient when it has actually received/loaded the message. */
export class DeliveredDto {
  @IsString()
  messageId: string;
}

export class ReactDto {
  @IsString()
  messageId: string;

  @IsString()
  emoji: string;
}

export class UnreactDto {
  @IsString()
  messageId: string;
}
