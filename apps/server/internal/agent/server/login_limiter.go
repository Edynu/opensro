package agentserver

import (
	"net"
	"sync"
	"time"
)

const (
	loginAttemptBurst     = 10
	loginAttemptRefill    = 6 * time.Second
	maxLoginClientBuckets = 4096
)

type loginBucket struct {
	tokens     int
	lastRefill time.Time
	lastSeen   time.Time
}

// loginLimiter bounds expensive bcrypt work per client address. Agent is a
// loopback service behind the deployment's TLS edge, so its caller supplies
// the already-resolved client address.
type loginLimiter struct {
	mu      sync.Mutex
	now     func() time.Time
	buckets map[string]loginBucket
}

func newLoginLimiter(now func() time.Time) *loginLimiter {
	return &loginLimiter{
		now:     now,
		buckets: make(map[string]loginBucket),
	}
}

func (limiter *loginLimiter) Allow(remoteAddr string) bool {
	key := loginClientKey(remoteAddr)
	now := limiter.now()

	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	bucket, exists := limiter.buckets[key]
	if !exists {
		if len(limiter.buckets) >= maxLoginClientBuckets {
			limiter.evictOldest()
		}
		bucket = loginBucket{
			tokens:     loginAttemptBurst,
			lastRefill: now,
		}
	}
	if elapsed := now.Sub(bucket.lastRefill); elapsed >= loginAttemptRefill {
		refills := int(elapsed / loginAttemptRefill)
		bucket.tokens = min(loginAttemptBurst, bucket.tokens+refills)
		bucket.lastRefill = bucket.lastRefill.Add(
			time.Duration(refills) * loginAttemptRefill,
		)
	}
	bucket.lastSeen = now
	if bucket.tokens == 0 {
		limiter.buckets[key] = bucket
		return false
	}
	bucket.tokens--
	limiter.buckets[key] = bucket
	return true
}

func (limiter *loginLimiter) evictOldest() {
	var (
		oldestKey string
		oldest    time.Time
		found     bool
	)
	for key, bucket := range limiter.buckets {
		if !found || bucket.lastSeen.Before(oldest) {
			oldestKey = key
			oldest = bucket.lastSeen
			found = true
		}
	}
	if found {
		delete(limiter.buckets, oldestKey)
	}
}

func loginClientKey(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil && host != "" {
		return host
	}
	if remoteAddr == "" {
		return "unknown"
	}
	return remoteAddr
}
