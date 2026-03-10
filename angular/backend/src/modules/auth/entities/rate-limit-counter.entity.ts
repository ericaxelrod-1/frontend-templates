import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity()
export class RateLimitCounter {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /**
     * Universal key used to identify the rate limit scope.
     * e.g., 'ip:192.168.1.1', 'email:admin@example.com', or 'ip_email:1.2.3.4:admin@example.com'
     */
    @Column({ unique: true })
    key: string;

    /**
     * Number of occurrences within the current window
     */
    @Column({ default: 0 })
    count: number;

    /**
     * When this specific rate limit window expires
     */
    @Column()
    windowExpiresAt: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
