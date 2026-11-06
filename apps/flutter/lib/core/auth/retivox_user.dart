enum RetivoxRole { owner, admin, employee }

RetivoxRole retivoxRoleFromString(String? value) {
  return switch (value) {
    'owner' => RetivoxRole.owner,
    'admin' => RetivoxRole.admin,
    'employee' => RetivoxRole.employee,
    _ => throw const FormatException(
      'This account does not have a supported Retivox role.',
    ),
  };
}

class BranchAccess {
  const BranchAccess({
    required this.id,
    required this.name,
    required this.role,
  });

  final String id;
  final String name;
  final String role;

  Map<String, Object?> toJson() => {'id': id, 'name': name, 'role': role};

  factory BranchAccess.fromJson(Map<String, dynamic> json) => BranchAccess(
    id: json['id'] as String,
    name: json['name'] as String,
    role: json['role'] as String,
  );
}

class RetivoxUser {
  const RetivoxUser({
    required this.id,
    required this.businessId,
    required this.name,
    required this.email,
    required this.businessName,
    required this.role,
    required this.branches,
    required this.currency,
  });

  final String id;
  final String businessId;
  final String name;
  final String email;
  final String businessName;
  final RetivoxRole role;
  final List<BranchAccess> branches;
  final String currency;

  RetivoxUser copyWith({
    String? name,
    String? businessName,
    String? currency,
  }) => RetivoxUser(
    id: id,
    businessId: businessId,
    name: name ?? this.name,
    email: email,
    businessName: businessName ?? this.businessName,
    role: role,
    branches: branches,
    currency: currency ?? this.currency,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'businessId': businessId,
    'name': name,
    'email': email,
    'businessName': businessName,
    'role': role.name,
    'branches': branches.map((branch) => branch.toJson()).toList(),
    'currency': currency,
  };

  factory RetivoxUser.fromJson(Map<String, dynamic> json) => RetivoxUser(
    id: json['id'] as String,
    businessId: json['businessId'] as String,
    name: json['name'] as String,
    email: json['email'] as String,
    businessName: json['businessName'] as String? ?? 'Retivox',
    role: retivoxRoleFromString(json['role'] as String?),
    branches: (json['branches'] as List<dynamic>)
        .map((branch) => BranchAccess.fromJson(branch as Map<String, dynamic>))
        .toList(),
    currency: json['currency'] as String? ?? 'KES',
  );
}
