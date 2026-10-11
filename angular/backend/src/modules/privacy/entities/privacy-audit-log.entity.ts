import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('privacy_audit_logs')
export class PrivacyAuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  ticketId: number;

  @Column({ nullable: true })
  userId: number;

  @Column()
  action: string;

  @Column()
  hmacHash: string;

  @Column()
  kid: string;

  @CreateDateColumn()
  createdAt: Date;
}
