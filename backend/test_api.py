"""
Test script for the MANGOSORT backend API
"""
import requests
import json
from pathlib import Path

API_URL = "http://localhost:5000"

def test_health():
    """Test the health endpoint"""
    try:
        response = requests.get(f"{API_URL}/api/health")
        print("✅ Health Check:")
        print(json.dumps(response.json(), indent=2))
        return True
    except Exception as e:
        print(f"❌ Health Check Failed: {e}")
        return False

def test_classes():
    """Get available classes"""
    try:
        response = requests.get(f"{API_URL}/api/classes")
        print("\n✅ Classes:")
        print(json.dumps(response.json(), indent=2))
        return True
    except Exception as e:
        print(f"❌ Classes Failed: {e}")
        return False

def test_predict(image_path):
    """Test prediction with an image"""
    if not Path(image_path).exists():
        print(f"❌ Image not found: {image_path}")
        return False
    
    try:
        with open(image_path, 'rb') as f:
            files = {'image': f}
            response = requests.post(f"{API_URL}/api/predict", files=files)
        print(f"\n✅ Prediction for {image_path}:")
        print(json.dumps(response.json(), indent=2))
        return True
    except Exception as e:
        print(f"❌ Prediction Failed: {e}")
        return False

if __name__ == "__main__":
    print("🧪 MANGOSORT Backend API Tests")
    print("=" * 50)
    
    test_health()
    test_classes()
    
    # Uncomment to test with an actual image
    # test_predict("path/to/your/image.jpg")
