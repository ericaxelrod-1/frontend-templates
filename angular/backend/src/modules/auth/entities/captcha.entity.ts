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

  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean;

  /**
   * Getter for backward compatibility with services expecting used
   * Returns the isUsed value
   */
  get used(): boolean {
    return this.isUsed;
  }

  /**
   * Setter for backward compatibility with services setting used
   * Sets the isUsed field
   */
  set used(value: boolean) {
    this.isUsed = value;
  }

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'ip_address', type: 'text', nullable: true })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
