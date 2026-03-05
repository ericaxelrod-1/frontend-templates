import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('captcha')
export class Captcha {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', default: 'text' })
  type: 'text' | 'image' | 'math' | 'puzzle';

  @Column({ type: 'text', unique: true })
  token: string;

  @Column({ type: 'text' })
  challenge: string;

  @Column({ type: 'text' })
  solution: string;

  @Column({ type: 'boolean', default: false })
  isUsed: boolean;


  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'text', nullable: true })
  ipAddress: string;


  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;

}
