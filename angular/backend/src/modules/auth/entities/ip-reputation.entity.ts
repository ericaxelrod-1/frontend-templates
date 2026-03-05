import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('ip_reputation')
export class IPReputation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', unique: true })
  ipAddress: string;

  @Column({ type: 'text', default: 'unknown' })
  status: string;

  @Column({ type: 'integer', default: 100 })
  reputationScore: number;

  @Column({ type: 'text', nullable: true })
  geoLocationInfo: string;

  @Column({ type: 'text', nullable: true })
  accessStatistics: string;

  @Column({ type: 'text', nullable: true })
  blockHistory: string;

  @Column({ type: 'integer', default: 0 })
  failedLoginAttempts: number;




  @Column({ type: 'boolean', default: false })
  isManuallyBlocked: boolean;




  @Column({ type: 'datetime', nullable: true })
  blockedUntilAuto: Date;




  @Column({ type: 'integer', default: 0 })
  captchaChallengeCount: number;




  @Column({ type: 'text', nullable: true })
  notes: string;


  @CreateDateColumn({ type: 'datetime' })
  firstSeenAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  lastUpdatedAt: Date;

}
