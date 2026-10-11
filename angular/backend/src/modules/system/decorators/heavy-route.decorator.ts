import { SetMetadata } from '@nestjs/common';

export const IS_HEAVY_ROUTE_KEY = 'isHeavyRoute';
export const HeavyRoute = () => SetMetadata(IS_HEAVY_ROUTE_KEY, true);
