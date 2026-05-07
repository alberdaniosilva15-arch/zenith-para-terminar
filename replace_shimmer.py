import sys

# 1. PassengerHome CTA (RideRequestForm.tsx)
try:
    with open('src/components/passenger/RideRequestForm.tsx', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace the button class
    old_btn = 'className="zr-button zr-button--sm" onClick={() => onConfirmRideRequest(finalFare)}'
    new_btn = 'className="zr-button zr-button--sm animate-shimmer" onClick={() => onConfirmRideRequest(finalFare)}'
    if old_btn in content:
        content = content.replace(old_btn, new_btn)
        with open('src/components/passenger/RideRequestForm.tsx', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Updated RideRequestForm.tsx")
    else:
        print("Could not find the target string in RideRequestForm.tsx")
except Exception as e:
    print("Error updating RideRequestForm.tsx:", e)

# 2. AdminDashboard.tsx - remove animate-pulse
try:
    with open('src/components/AdminDashboard.tsx', 'r', encoding='utf-8') as f:
        content = f.read()
    
    if 'animate-pulse' in content:
        content = content.replace('animate-pulse', '')
        with open('src/components/AdminDashboard.tsx', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Updated AdminDashboard.tsx")
    else:
        print("animate-pulse not found in AdminDashboard.tsx")
except Exception as e:
    print("Error updating AdminDashboard.tsx:", e)

# 3. KazeMascot.tsx - remove animate-pulse
try:
    with open('src/components/KazeMascot.tsx', 'r', encoding='utf-8') as f:
        content = f.read()
    
    if 'animate-pulse' in content:
        content = content.replace('animate-pulse', '')
        with open('src/components/KazeMascot.tsx', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Updated KazeMascot.tsx")
    else:
        print("animate-pulse not found in KazeMascot.tsx")
except Exception as e:
    print("Error updating KazeMascot.tsx:", e)

