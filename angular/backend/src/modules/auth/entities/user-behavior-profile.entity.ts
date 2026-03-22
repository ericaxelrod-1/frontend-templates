import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    UpdateDateColumn,
    OneToOne,
    JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity()
export class UserBehaviorProfile {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @OneToOne(() => User, (user) => user.id, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @Column({ name: 'user_id' })
    userId: number;

    /**
     * An array of 24 booleans (or a bitmask) representing the hours (0-23 UTC) 
     * this user typically logs in.
     */
    @Column('simple-json', { nullable: true })
    typicalLoginHours: boolean[];

    /**
     * The list of IP address strings from which this user has successfully logged in before.
     */
    @Column('simple-json', { nullable: true })
    knownIps: string[];

    /**
     * The list of Browser User-Agent strings this user is known to use.
     */
    @Column('simple-json', { nullable: true })
    knownUserAgents: string[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
