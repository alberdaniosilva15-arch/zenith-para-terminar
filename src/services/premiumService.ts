import { supabase } from '../lib/supabase';
import type {
  CargoBooking,
  CharterBooking,
  PremiumBooking,
  ServicePricing,
  ServiceType,
} from '../types';

type PremiumCoreInput = {
  userId: string;
  pickupAddress?: string;
  pickupLat?: number | null;
  pickupLng?: number | null;
  destAddress?: string;
  destLat?: number | null;
  destLng?: number | null;
  scheduledAt?: string | null;
  durationHours?: number | null;
  vehicleClass?: 'standard' | 'suv' | 'executive' | null;
  notes?: string | null;
  favoriteDriverId?: string | null;
  notifyMe?: boolean;
  routeStops?: string[] | null;
};

type CreatePrivateDriverBookingInput = PremiumCoreInput & {
  city?: string;
  estimatedDistanceKm?: number;
};

type CreateCharterBookingInput = PremiumCoreInput & {
  city?: string;
  capacity: 20 | 40 | 60;
  eventType?: string | null;
  routeDescription?: string | null;
  returnTrip?: boolean;
  estimatedDistanceKm?: number;
};

type CreateCargoBookingInput = PremiumCoreInput & {
  city?: string;
  cargoType: 'light' | 'medium' | 'heavy';
  needsHelpers?: boolean;
  helperCount?: number;
  estimatedWeightKg?: number | null;
  urgency?: 'normal' | 'express';
  specialInstructions?: string | null;
  estimatedDistanceKm?: number;
};

export interface PremiumPriceQuote {
  pricing: ServicePricing;
  totalKz: number;
  breakdown: {
    baseFareKz: number;
    distanceKz: number;
    durationKz: number;
    helpersKz: number;
    urgencyKz: number;
    capacityKz: number;
  };
}

async function rollbackPremiumBooking(bookingId: string, context: string): Promise<void> {
  const { error } = await supabase
    .from('premium_bookings')
    .delete()
    .eq('id', bookingId);

  if (error) {
    console.error(`[${context}.rollback]`, error);
  }
}

class PremiumService {
  async getPricing(serviceType: ServiceType, city = 'Luanda'): Promise<ServicePricing | null> {
    const { data, error } = await supabase
      .from('service_pricing')
      .select('*')
      .eq('service_type', serviceType)
      .eq('city', city)
      .eq('active', true)
      .maybeSingle();

    if (error) {
      console.warn('[premiumService.getPricing]', error.message);
      return null;
    }

    return (data ?? null) as ServicePricing | null;
  }

  async estimatePrivateDriverPrice(params: {
    city?: string;
    hours: number;
    estimatedDistanceKm?: number;
  }): Promise<PremiumPriceQuote | null> {
    const pricing = await this.getPricing('private_driver', params.city);
    if (!pricing) return null;

    const distanceKz = Math.round((params.estimatedDistanceKm ?? 0) * pricing.price_per_km_kz);
    const durationKz = Math.round(params.hours * pricing.price_per_hour_kz);
    const baseFareKz = Math.round(pricing.base_fare_kz);
    const totalKz = Math.max(
      Math.round((baseFareKz + distanceKz + durationKz) * pricing.surge_multiplier),
      Math.round(pricing.minimum_fare_kz),
    );

    return {
      pricing,
      totalKz,
      breakdown: {
        baseFareKz,
        distanceKz,
        durationKz,
        helpersKz: 0,
        urgencyKz: 0,
        capacityKz: 0,
      },
    };
  }

  async estimateCharterPrice(params: {
    city?: string;
    capacity: number;
    estimatedDistanceKm?: number;
    returnTrip?: boolean;
  }): Promise<PremiumPriceQuote | null> {
    const pricing = await this.getPricing('charter', params.city);
    if (!pricing) return null;

    const capacityFactor = params.capacity / 20;
    const tripFactor = params.returnTrip ? 1.8 : 1;
    const baseFareKz = Math.round(pricing.base_fare_kz);
    const distanceKz = Math.round((params.estimatedDistanceKm ?? 0) * pricing.price_per_km_kz * tripFactor);
    const capacityKz = Math.round(baseFareKz * Math.max(capacityFactor - 1, 0) * 0.35);
    const totalKz = Math.max(
      Math.round((baseFareKz + distanceKz + capacityKz) * pricing.surge_multiplier),
      Math.round(pricing.minimum_fare_kz),
    );

    return {
      pricing,
      totalKz,
      breakdown: {
        baseFareKz,
        distanceKz,
        durationKz: 0,
        helpersKz: 0,
        urgencyKz: 0,
        capacityKz,
      },
    };
  }

  async estimateCargoPrice(params: {
    city?: string;
    weightKg?: number | null;
    helperCount?: number;
    estimatedDistanceKm?: number;
    urgency?: 'normal' | 'express';
  }): Promise<PremiumPriceQuote | null> {
    const pricing = await this.getPricing('cargo', params.city);
    if (!pricing) return null;

    const weightFactor = params.weightKg == null
      ? 1
      : params.weightKg > 200
        ? 1.7
        : params.weightKg >= 50
          ? 1.3
          : 1;
    const urgencyMultiplier = params.urgency === 'express' ? 0.3 : 0;
    const baseFareKz = Math.round(pricing.base_fare_kz);
    const distanceKz = Math.round((params.estimatedDistanceKm ?? 0) * pricing.price_per_km_kz * weightFactor);
    const helpersKz = Math.max(params.helperCount ?? 0, 0) * 1000;
    const urgencyKz = Math.round((baseFareKz + distanceKz) * urgencyMultiplier);
    const totalKz = Math.max(
      Math.round((baseFareKz + distanceKz + helpersKz + urgencyKz) * pricing.surge_multiplier),
      Math.round(pricing.minimum_fare_kz),
    );

    return {
      pricing,
      totalKz,
      breakdown: {
        baseFareKz,
        distanceKz,
        durationKz: 0,
        helpersKz,
        urgencyKz,
        capacityKz: 0,
      },
    };
  }

  async createPrivateDriverBooking(input: CreatePrivateDriverBookingInput): Promise<PremiumBooking | null> {
    const quote = await this.estimatePrivateDriverPrice({
      city: input.city,
      hours: Math.max(input.durationHours ?? 2, 2),
      estimatedDistanceKm: input.estimatedDistanceKm,
    });

    const { data, error } = await supabase
      .from('premium_bookings')
      .insert({
        user_id: input.userId,
        service_type: 'private_driver',
        pickup_address: input.pickupAddress ?? null,
        pickup_lat: input.pickupLat ?? null,
        pickup_lng: input.pickupLng ?? null,
        dest_address: input.destAddress ?? null,
        dest_lat: input.destLat ?? null,
        dest_lng: input.destLng ?? null,
        scheduled_at: input.scheduledAt ?? null,
        duration_hours: Math.max(input.durationHours ?? 2, 2),
        vehicle_class: input.vehicleClass ?? 'standard',
        notes: input.notes ?? null,
        favorite_driver_id: input.favoriteDriverId ?? null,
        notify_me: input.notifyMe ?? false,
        route_stops: input.routeStops ?? null,
        price_kz: quote?.totalKz ?? 0,
        pricing_snapshot: quote ? {
          pricingId: quote.pricing.id,
          breakdown: quote.breakdown,
        } : null,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[premiumService.createPrivateDriverBooking]', error);
      return null;
    }

    return data as PremiumBooking;
  }

  async createCharterBooking(input: CreateCharterBookingInput): Promise<PremiumBooking | null> {
    const quote = await this.estimateCharterPrice({
      city: input.city,
      capacity: input.capacity,
      estimatedDistanceKm: input.estimatedDistanceKm,
      returnTrip: input.returnTrip,
    });

    const { data: booking, error: bookingError } = await supabase
      .from('premium_bookings')
      .insert({
        user_id: input.userId,
        service_type: 'charter',
        pickup_address: input.pickupAddress ?? null,
        pickup_lat: input.pickupLat ?? null,
        pickup_lng: input.pickupLng ?? null,
        dest_address: input.destAddress ?? null,
        dest_lat: input.destLat ?? null,
        dest_lng: input.destLng ?? null,
        scheduled_at: input.scheduledAt ?? null,
        notes: input.notes ?? null,
        notify_me: input.notifyMe ?? false,
        route_stops: input.routeStops ?? null,
        price_kz: quote?.totalKz ?? 0,
        pricing_snapshot: quote ? {
          pricingId: quote.pricing.id,
          breakdown: quote.breakdown,
        } : null,
      })
      .select('*')
      .single();

    if (bookingError || !booking) {
      console.error('[premiumService.createCharterBooking]', bookingError);
      return null;
    }

    const { error: extraError } = await supabase.from('charter_bookings').insert({
      booking_id: booking.id,
      capacity: input.capacity,
      event_type: input.eventType ?? null,
      route_description: input.routeDescription ?? null,
      return_trip: input.returnTrip ?? false,
    });

    if (extraError) {
      console.error('[premiumService.createCharterBooking.extra]', extraError);
      await rollbackPremiumBooking(booking.id, 'premiumService.createCharterBooking');
      return null;
    }

    return booking as PremiumBooking;
  }

  async createCargoBooking(input: CreateCargoBookingInput): Promise<PremiumBooking | null> {
    const quote = await this.estimateCargoPrice({
      city: input.city,
      weightKg: input.estimatedWeightKg,
      helperCount: input.helperCount,
      estimatedDistanceKm: input.estimatedDistanceKm,
      urgency: input.urgency,
    });

    const { data: booking, error: bookingError } = await supabase
      .from('premium_bookings')
      .insert({
        user_id: input.userId,
        service_type: 'cargo',
        pickup_address: input.pickupAddress ?? null,
        pickup_lat: input.pickupLat ?? null,
        pickup_lng: input.pickupLng ?? null,
        dest_address: input.destAddress ?? null,
        dest_lat: input.destLat ?? null,
        dest_lng: input.destLng ?? null,
        scheduled_at: input.scheduledAt ?? null,
        notes: input.notes ?? null,
        notify_me: input.notifyMe ?? false,
        route_stops: input.routeStops ?? null,
        price_kz: quote?.totalKz ?? 0,
        pricing_snapshot: quote ? {
          pricingId: quote.pricing.id,
          breakdown: quote.breakdown,
        } : null,
      })
      .select('*')
      .single();

    if (bookingError || !booking) {
      console.error('[premiumService.createCargoBooking]', bookingError);
      return null;
    }

    const { error: extraError } = await supabase.from('cargo_bookings').insert({
      booking_id: booking.id,
      cargo_type: input.cargoType,
      needs_helpers: input.needsHelpers ?? false,
      helper_count: Math.max(input.helperCount ?? 0, 0),
      estimated_weight_kg: input.estimatedWeightKg ?? null,
      urgency: input.urgency ?? 'normal',
      special_instructions: input.specialInstructions ?? null,
    });

    if (extraError) {
      console.error('[premiumService.createCargoBooking.extra]', extraError);
      await rollbackPremiumBooking(booking.id, 'premiumService.createCargoBooking');
      return null;
    }

    return booking as PremiumBooking;
  }

  async getMyBookings(userId: string): Promise<PremiumBooking[]> {
    const { data, error } = await supabase
      .from('premium_bookings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[premiumService.getMyBookings]', error);
      return [];
    }

    return (data ?? []) as PremiumBooking[];
  }

  async getBookingDetails(bookingId: string): Promise<{
    booking: PremiumBooking | null;
    cargo: CargoBooking | null;
    charter: CharterBooking | null;
  }> {
    const { data: booking } = await supabase
      .from('premium_bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) {
      return { booking: null, cargo: null, charter: null };
    }

    const [cargoRes, charterRes] = await Promise.all([
      supabase.from('cargo_bookings').select('*').eq('booking_id', bookingId).maybeSingle(),
      supabase.from('charter_bookings').select('*').eq('booking_id', bookingId).maybeSingle(),
    ]);

    return {
      booking: booking as PremiumBooking,
      cargo: (cargoRes.data ?? null) as CargoBooking | null,
      charter: (charterRes.data ?? null) as CharterBooking | null,
    };
  }

  async cancelBooking(bookingId: string): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) {
      return false;
    }

    const { data, error } = await supabase
      .from('premium_bookings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('user_id', user.id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[premiumService.cancelBooking]', error);
      return false;
    }

    return !!data;
  }

  async getFavoriteDrivers(userId: string): Promise<Array<{
    driver_id: string;
    driver_name: string;
    rating: number;
    total_rides: number;
  }>> {
    const { data: rides, error } = await supabase
      .from('rides')
      .select('driver_id, completed_at')
      .eq('passenger_id', userId)
      .eq('status', 'completed')
      .not('driver_id', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(120);

    if (error || !rides?.length) {
      if (error) console.error('[premiumService.getFavoriteDrivers.rides]', error);
      return [];
    }

    const driverIds = Array.from(new Set(
      rides
        .map((ride) => ride.driver_id)
        .filter((driverId): driverId is string => !!driverId),
    ));

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, name, rating, total_rides')
      .in('user_id', driverIds);

    if (profilesError) {
      console.error('[premiumService.getFavoriteDrivers.profiles]', profilesError);
      return [];
    }

    return (profiles ?? [])
      .filter((profile) => Number(profile.rating ?? 0) >= 4.5)
      .map((profile) => ({
        driver_id: profile.user_id,
        driver_name: profile.name ?? 'Motorista Zenith',
        rating: Number(profile.rating ?? 0),
        total_rides: Number(profile.total_rides ?? 0),
      }))
      .sort((left, right) => right.rating - left.rating || right.total_rides - left.total_rides);
  }
}

export const premiumService = new PremiumService();
