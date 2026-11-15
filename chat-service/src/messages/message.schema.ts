import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true, collection: 'messages' })
export class Message {
  @Prop({ required: true, index: true })
  conversationId: string;

  @Prop({ required: true, index: true })
  senderId: string;

  // Not `required`: an image-only message has no text, and Mongoose treats "" as missing.
  @Prop({ default: '' })
  content: string;

  @Prop({ type: [String], default: [] })
  mediaUrls: string[];

  @Prop({ default: 'sent' })
  status: string;

  /** 'user' for authored messages, 'system' for membership/rename events. */
  @Prop({ default: 'user', index: true })
  type: string;

  /**
   * Structured system event so the UI can render "A added B" with real names instead of a
   * pre-baked string. Null for ordinary messages.
   */
  @Prop({ type: Object, default: null })
  system: { event: string; actorId?: string; targetId?: string; name?: string } | null;

  /**
   * Retry guard. A retried membership call inside the same short window collapses onto the same
   * key, so the unique index stops duplicate system messages without suppressing a genuine
   * repeat action later on.
   *
   * Deliberately has no `default`: the field must stay ABSENT on ordinary messages. A sparse
   * unique index skips missing fields but still enforces uniqueness on an explicit `null`, so
   * defaulting to null would make the second user message in the collection fail to insert.
   */
  @Prop({ type: String })
  dedupeKey?: string;

  /** Server-built snapshot of a shared post. Null for ordinary messages. */
  @Prop({ type: Object, default: null })
  post?: { id: string; authorId: string; authorName: string; authorHandle: string; caption: string; mediaUrl: string | null } | null;

  @Prop({ type: [String], default: [] })
  readBy: string[];

  @Prop({ type: [{ userId: String, emoji: String, createdAt: Date }], default: [] })
  reactions: Array<{ userId: string; emoji: string; createdAt: Date }>;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: -1 });
// Sparse so the (many) ordinary messages with no dedupeKey are unaffected.
MessageSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
