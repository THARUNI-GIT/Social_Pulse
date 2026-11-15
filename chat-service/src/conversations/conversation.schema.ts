import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ConversationDocument = Conversation & Document;

export type ConversationType = 'direct' | 'group';

@Schema({ timestamps: true, collection: 'conversations' })
export class Conversation {
  @Prop({ default: 'direct' })
  type: string;

  /** Group title. Direct conversations have none (the UI shows the other participant). */
  @Prop({ default: null })
  name?: string | null;

  @Prop({ type: [String], required: true, index: true })
  members: string[];

  /** Creator of a group; also the only one who can promote/demote admins. */
  @Prop({ default: null })
  createdBy?: string | null;

  /** Members allowed to add/remove others and rename the group. */
  @Prop({ type: [String], default: [] })
  admins: string[];

  /** Dismissed-for (direct) or left (group) members: hidden from that user's list only. */
  @Prop({ type: [String], default: [] })
  hiddenFor: string[];

  @Prop({ type: Object, default: null })
  lastMessage: any;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ members: 1 });
