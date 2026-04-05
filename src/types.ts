// =============================================================================
// MOTOGO AI v2.1 — types.ts
// Adicionado: AuctionDriver, PostRideState, driver_bids, driver_confirmed
// =============================================================================

export enum UserRole {
  PASSENGER = 'passenger',
  DRIVER    = 'driver',
  ADMIN     = 'admin',
}

export enum RideStatus {
  IDLE        = 'idle',
  BROWSING    = 'browsing',     // NOVO: passageiro a ver lista de motoristas
  SEARCHING   = 'searching',    // fallback se não houver motoristas disponíveis
  ACCEPTED    = 'accepted',     // passageiro escolheu um motorista
  PICKING_UP  = 'picking_up',   // motorista confirmou, a caminho
  IN_PROGRESS = 'in_progress',
  COMPLETED   = 'completed',
  CANCELLED   = 'cancelled',
}

export enum DriverStatus {
  OFFLINE   = 'offline',
  AVAILABLE = 'available',
  BUSY      = 'busy',
}

export interface LatLng { lat: number; lng: number; }

export const LUANDA_CENTER: LatLng = { lat: -8.8368, lng: 13.2343 };

// =============================================================================
// BASE DE DADOS
// =============================================================================

export interface DbUser {
  id: string; email: string; role: UserRole;
  created_at: string; updated_at: string;
}

export interface DbProfile {
  id: string; user_id: string; name: string;
  avatar_url: string | null; phone: string | null;
  rating: number; total_rides: number; level: UserLevel;
  created_at: string; updated_at: string;
}

export interface DbDriverLocation {
  driver_id: string; lat: number; lng: number;
  heading: number | null; status: DriverStatus; updated_at: string;
}

export interface DbRide {
  id: string;
  passenger_id: string; driver_id: string | null;
  origin_address: string; origin_lat: number; origin_lng: number;
  dest_address: string; dest_lat: number; dest_lng: number;
  distance_km: number | null; duration_min: number | null;
  surge_multiplier: number; price_kz: number;
  status: RideStatus;
  driver_confirmed: boolean;
  created_at: string; accepted_at: string | null;
  pickup_at: string | null; started_at: string | null;
  completed_at: string | null; cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface DbWallet {
  id: string; user_id: string; balance: number;
  currency: string; updated_at: string;
}

export interface DbTransaction {
  id: string; user_id: string; ride_id: string | null;
  amount: number; type: TransactionType;
  description: string | null; balance_after: number; created_at: string;
}

export interface DbPost {
  id: string; user_id: string; content: string;
  post_type: PostType; location: string | null;
  likes: number; created_at: string;
  profiles?: Pick<DbProfile, 'name' | 'avatar_url' | 'rating'>;
}

export interface DbContract {
  id: string; user_id: string; contract_type: 'school' | 'work';
  title: string; address: string; dest_lat: number; dest_lng: number;
  time_start: string; time_end: string; parent_monitoring: boolean;
  km_accumulated: number; bonus_kz: number; active: boolean; created_at: string;
}

// =============================================================================
// LEILÃO DE MOTORISTAS (novo em v2.1)
// =============================================================================

/** Motorista disponível para o passageiro escolher */
export interface AuctionDriver {
  driver_id:   string;
  driver_name: string;
  avatar_url:  string | null;
  rating:      number;
  total_rides: number;
  level:       UserLevel;
  distance_m:  number;
  eta_min:     number;
  heading:     number | null;
}

/** Estado do leilão no frontend */
export interface AuctionState {
  loading:         boolean;
  drivers:         AuctionDriver[];
  selectedDriver:  AuctionDriver | null;
  error:           string | null;
}

// =============================================================================
// POST-RIDE REVIEW (novo em v2.1)
// =============================================================================

export interface PostRideState {
  active:       boolean;
  rideId:       string | null;
  driverId:     string | null;
  driverName:   string | null;
  driverRating: number | null;
  priceKz:      number | null;
  distanceKm?:  number | null;
  durationMin?: number | null;
}

export interface PostRideReviewInput {
  ride_id:    string;
  driver_id:  string;
  score:      number;       // 1-5
  comment?:   string;
}

// =============================================================================
// UI STATE
// =============================================================================

export interface RideState {
  status:          RideStatus;
  rideId?:         string;
  pickup?:         string;
  destination?:    string;
  pickupCoords?:   LatLng;
  destCoords?:     LatLng;
  carLocation?:    LatLng;
  surgeMultiplier: number;
  priceKz?:        number;
  driverId?:       string;
  driverName?:     string;
  passengerName?:  string;
  driverRating?:   number;
  driverConfirmed?: boolean;
}

export interface AuthState {
  user: DbUser | null; profile: DbProfile | null; loading: boolean;
}

export interface LocationResult {
  name: string;
  type: 'bairro' | 'restaurante' | 'rua' | 'monumento' | 'servico' | 'hospital' | 'escola';
  description: string; coords: LatLng;
  rating?: number; address?: string; isPopular?: boolean;
}

export interface NearbyDriver {
  driver_id: string; driver_name: string;
  rating: number; distance_m: number; heading: number | null;
}

export interface PriceEstimate {
  price_kz: number; distance_km: number; duration_min: number;
  surge_multiplier: number; traffic_level: 'low' | 'medium' | 'high';
  breakdown: { base_kz: number; per_km_kz: number; surge_kz: number; total_kz: number; };
}

export interface AutonomousCommand {
  id: string; type: 'REALLOCATE' | 'SURGE_PRICE' | 'SECURITY_DISPATCH' | 'ROUTE_OPTIMIZE';
  target: string; reason: string; intensity: number; timestamp: number;
  status: 'EXECUTED' | 'LOGGED';
}

export interface ChatMessage {
  id: string; senderRole: UserRole; senderName: string; text: string;
  audioUrl?: string; zone: string; timestamp: number;
  type: 'traffic' | 'safety' | 'fuel' | 'events' | 'all'; confirmations: number;
}

export interface RideReceipt {
  idealDistance: number; realDistance: number; difference: number;
  justification: string; totalCost: string; netProfit?: string; fuelExpense?: string;
}

export type UserLevel    = 'Novato' | 'Bronze' | 'Prata' | 'Ouro' | 'Diamante';
export type PostType     = 'status' | 'alert' | 'event';
export type TransactionType = 'ride_payment' | 'ride_earning' | 'top_up' | 'refund' | 'bonus' | 'withdrawal';
export type TabType      = 'home' | 'contrato' | 'rides' | 'wallet' | 'profile' | 'social' | 'precos';
export type KazeCategory = 'motivation' | 'education' | 'philosophy' | 'anime' | 'spiritual';

export interface Achievement { id: string; title: string; icon: string; date: string; }
export interface AppError { code: string; message: string; details?: unknown; }

// Multicaixa Express
export interface MulticaixaPaymentRequest {
  amount_kz:    number;
  phone_number: string; // 9xxxxxxxx
  description:  string;
  reference?:   string;
}

export interface MulticaixaPaymentResponse {
  success:      boolean;
  reference:    string;
  message:      string;
  payment_url?: string;
}

// =============================================================================
// TIPOS EM FALTA — adicionados para Contract.tsx e SocialFeed.tsx
// =============================================================================

export interface ContractConfig {
  id:               string;
  type:             'school' | 'work';
  title:            string;
  address:          string;
  timeStart:        string;
  timeEnd:          string;
  parentMonitoring: boolean;
  kmAccumulated:    number;
  bonusKz:          number;
}

/** Post da feed social (frontend — diferente de DbPost que é da BD) */
export interface Post {
  id:        string;
  userId:    string;
  userName:  string;
  userRole:  UserRole;
  content:   string;
  type:      'status' | 'alert' | 'event';
  location?: string;
  likes:     number;
  comments:  number;
  timestamp: number;
}
// =============================================================================
// MOTOGO v3.0 — NOVOS TIPOS (adicionar ao fim de types.ts — não apagar nada)
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// ZONA PREÇOS
// ─────────────────────────────────────────────────────────────────────────────
export interface ZonePrice {
  origin_zone: string;
  dest_zone:   string;
  price_kz:    number;
  distance_km: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// KAZE PREDITIVO
// ─────────────────────────────────────────────────────────────────────────────
export interface RidePrediction {
  id:              string;
  user_id:         string;
  origin_address:  string;
  origin_lat:      number;
  origin_lng:      number;
  dest_address:    string;
  dest_lat:        number;
  dest_lng:        number;
  frequency:       number;
  last_used_at:    string;
  best_hour:       number | null;
  avg_price_kz:    number | null;
  zone_price_kz:   number | null;
  origin_zone:     string | null;
  dest_zone:       string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FREE PERK (70 km → 5 km grátis)
// ─────────────────────────────────────────────────────────────────────────────
export interface FreePerkState {
  km_total:          number;
  free_km_available: number;
  km_to_next_perk:   number;
  perk_just_awarded: boolean;   // true quando acabou de ganhar — para animação
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTOGO SCORE
// ─────────────────────────────────────────────────────────────────────────────
export type ScoreLabel = 'Sem Historial' | 'Básico' | 'Médio' | 'Bom' | 'Excelente' | 'Extraordinário';

export interface MotoGoScore {
  driver_id:        string;
  score:            number;         // 0-1000
  score_label:      ScoreLabel;
  rides_component:  number;         // max 400
  rating_component: number;         // max 300
  level_component:  number;         // max 200
  consistency_pct:  number;         // 0-100%
  last_calculated:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTOGO PAY — PARCEIROS
// ─────────────────────────────────────────────────────────────────────────────
export type PartnerCategory = 'fuel' | 'food' | 'insurance' | 'mechanic' | 'supermarket';

export interface MotoGoPayPartner {
  id:           string;
  name:         string;
  category:     PartnerCategory;
  description:  string;
  discount_pct: number;
  logo_url:     string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESCOLAR — sessão de monitorização
// ─────────────────────────────────────────────────────────────────────────────
export interface SchoolTrackingSession {
  id:           string;
  contract_id:  string;
  ride_id:      string | null;
  public_token: string;         // UUID único para link dos pais
  status:       'active' | 'completed' | 'expired';
  expires_at:   string;
  parent_name:  string | null;
  parent_phone: string | null;
  alerts_sent:  number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE AUGMENTED (perfil com campos novos do v3)
// ─────────────────────────────────────────────────────────────────────────────
export interface DbProfileV3 extends DbProfile {
  km_total:          number;
  free_km_available: number;
  km_to_next_perk:   number;
}
